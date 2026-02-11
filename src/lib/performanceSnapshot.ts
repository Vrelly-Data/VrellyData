import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

interface DemographicEntry {
  value: string;
  count: number;
  percentage: number;
}

function topN(items: (string | null | undefined)[], n = 5): DemographicEntry[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const item of items) {
    const val = (item || '').trim();
    if (!val) continue;
    counts.set(val, (counts.get(val) || 0) + 1);
    total++;
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({
      value,
      count,
      percentage: Math.round((count / total) * 100),
    }));
}

function formatDemographics(label: string, entries: DemographicEntry[]): string {
  if (entries.length === 0) return '';
  return `${label}: ${entries.map(e => `${e.value} (${e.percentage}%)`).join(', ')}`;
}

function safeNum(val: unknown): number {
  return typeof val === 'number' ? val : Number(val) || 0;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function generatePerformanceSnapshot(campaignId: string): Promise<void> {
  try {
    // 1. Get campaign data
    const { data: campaign, error: campErr } = await supabase
      .from('synced_campaigns')
      .select('id, name, stats')
      .eq('id', campaignId)
      .maybeSingle();

    if (campErr || !campaign) {
      console.error('Snapshot: campaign not found', campaignId, campErr);
      return;
    }

    const stats = (campaign.stats as Record<string, unknown>) || {};

    // 2. Get contacts for demographic enrichment
    const { data: contacts } = await supabase
      .from('synced_contacts')
      .select('industry, job_title, company_size, city, country')
      .eq('campaign_id', campaignId)
      .limit(5000);

    // 3. Build demographics
    const industries = topN((contacts || []).map(c => c.industry));
    const jobTitles = topN((contacts || []).map(c => c.job_title));
    const companySizes = topN((contacts || []).map(c => c.company_size));
    const locations = topN((contacts || []).map(c => [c.city, c.country].filter(Boolean).join(', ')));

    // 4. Extract metrics
    const delivered = safeNum(stats.delivered);
    const replies = safeNum(stats.replies);
    const opens = safeNum(stats.opens);
    const clicked = safeNum(stats.clicked);
    const bounced = safeNum(stats.bounced);
    const interested = safeNum(stats.interested);
    const optedOut = safeNum(stats.optedOut);
    const liMessagesSent = safeNum(stats.linkedinMessagesSent);
    const liConnectionsSent = safeNum(stats.linkedinConnectionsSent);
    const liReplies = safeNum(stats.linkedinReplies);
    const liAccepted = safeNum(stats.linkedinConnectionsAccepted);

    const hasEmail = delivered > 0 || replies > 0 || opens > 0;
    const hasLinkedIn = liMessagesSent > 0 || liConnectionsSent > 0;

    if (!hasEmail && !hasLinkedIn) {
      console.log('Snapshot: no metrics for', campaign.name);
      return;
    }

    // 5. Determine channel
    const channels: string[] = [];
    if (hasEmail) channels.push('Email');
    if (hasLinkedIn) channels.push('LinkedIn');
    const channel = channels.join(' + ');

    // 6. Calculate rates
    const replyRate = rate(replies, delivered);
    const openRate = rate(opens, delivered);
    const clickRate = rate(clicked, delivered);
    const bounceRate = rate(bounced, delivered);
    const liAcceptanceRate = rate(liAccepted, liConnectionsSent);
    const liReplyRate = rate(liReplies, liMessagesSent + liConnectionsSent);

    // 7. Build content
    const date = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const contentParts: string[] = [`Channel: ${channel}`];

    if (hasEmail) {
      contentParts.push(
        `Delivered: ${delivered} | Opens: ${opens} (${openRate}%) | Replies: ${replies} (${replyRate}%) | Clicked: ${clicked} (${clickRate}%)`,
        `Bounced: ${bounced} (${bounceRate}%) | Interested: ${interested} | Opted Out: ${optedOut}`
      );
    }

    if (hasLinkedIn) {
      contentParts.push(
        `LI Connections Sent: ${liConnectionsSent} | Accepted: ${liAccepted} (${liAcceptanceRate}%)`,
        `LI Messages Sent: ${liMessagesSent} | LI Replies: ${liReplies} (${liReplyRate}%)`
      );
    }

    const demoLines = [
      formatDemographics('Top Industries', industries),
      formatDemographics('Top Job Titles', jobTitles),
      formatDemographics('Company Sizes', companySizes),
      formatDemographics('Top Locations', locations),
    ].filter(Boolean);

    if (demoLines.length > 0) {
      contentParts.push('', ...demoLines);
    }

    // 8. Build tags
    const tags: string[] = [];
    channels.forEach(ch => tags.push(ch.toLowerCase()));
    industries.slice(0, 3).forEach(i => tags.push(i.value.toLowerCase().replace(/\s+/g, '-')));
    const campaignWords = campaign.name.toLowerCase().split(/\s+/).slice(0, 2);
    campaignWords.forEach(w => { if (w.length > 2 && !tags.includes(w)) tags.push(w); });

    // 9. Build metrics JSONB
    const metricsJson: Record<string, unknown> = {
      delivered, replies, opens, clicked, bounced, interested, optedOut,
      replyRate, openRate, clickRate, bounceRate,
      linkedinMessagesSent: liMessagesSent,
      linkedinConnectionsSent: liConnectionsSent,
      linkedinReplies: liReplies,
      linkedinConnectionsAccepted: liAccepted,
      linkedinAcceptanceRate: liAcceptanceRate,
      linkedinReplyRate: liReplyRate,
      contactCount: (contacts || []).length,
      topIndustries: industries,
      topJobTitles: jobTitles,
      topCompanySizes: companySizes,
      snapshotDate: new Date().toISOString(),
    };

    const title = `${campaign.name} - Performance Baseline (${date})`;
    const content = contentParts.join('\n');

    // 10. Upsert: check if entry exists for this campaign
    const { data: existing } = await supabase
      .from('sales_knowledge')
      .select('id')
      .eq('source_campaign', campaignId)
      .eq('category', 'campaign_result')
      .maybeSingle();

    if (existing) {
      await supabase
        .from('sales_knowledge')
        .update({
          title,
          content,
          metrics: metricsJson as unknown as Json,
          tags,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Need user id for created_by — get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('Snapshot: no authenticated user');
        return;
      }

      await supabase
        .from('sales_knowledge')
        .insert({
          title,
          content,
          category: 'campaign_result',
          metrics: metricsJson as unknown as Json,
          tags,
          source_campaign: campaignId,
          created_by: user.id,
        });
    }

    console.log(`Performance snapshot saved for: ${campaign.name}`);
  } catch (err) {
    console.error('Snapshot generation failed:', err);
  }
}
