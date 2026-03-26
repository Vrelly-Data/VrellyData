import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, Trophy } from 'lucide-react';

interface Campaign {
  industry: string;
  sub: string;
  channel: 'LinkedIn' | 'Email' | 'MultiChannel';
  keywords: string[];
  contacts: number;
  openRate: number | null;
  replyRate: number;
}

const campaigns: Campaign[] = [
  { industry:"M&A", sub:"Lower middle market", channel:"LinkedIn", keywords:["PE-backed","add-on","EBITDA"], contacts:312, openRate:null, replyRate:18.4 },
  { industry:"M&A", sub:"Corporate development", channel:"MultiChannel", keywords:["strategic buyer","LOI","deal flow"], contacts:544, openRate:41, replyRate:16.9 },
  { industry:"Consulting", sub:"Management consulting", channel:"MultiChannel", keywords:["cost reduction","ops","C-suite"], contacts:2840, openRate:44, replyRate:15.2 },
  { industry:"M&A", sub:"Investment banking", channel:"LinkedIn", keywords:["sell-side","M&A advisory","mandate"], contacts:187, openRate:null, replyRate:14.8 },
  { industry:"Healthcare", sub:"Medical devices", channel:"Email", keywords:["FDA","clinical","procurement"], contacts:3610, openRate:38, replyRate:14.1 },
  { industry:"Consulting", sub:"Revenue operations", channel:"MultiChannel", keywords:["RevOps","GTM","pipeline"], contacts:4290, openRate:51, replyRate:13.7 },
  { industry:"Legal", sub:"M&A law", channel:"LinkedIn", keywords:["due diligence","deal counsel","PE"], contacts:265, openRate:null, replyRate:13.2 },
  { industry:"M&A", sub:"Family office outreach", channel:"LinkedIn", keywords:["direct deal","no intermediary","control"], contacts:144, openRate:null, replyRate:12.9 },
  { industry:"Healthcare", sub:"Regulatory affairs", channel:"Email", keywords:["FDA clearance","510k","compliance"], contacts:1820, openRate:42, replyRate:12.5 },
  { industry:"Recruiting", sub:"Executive search", channel:"MultiChannel", keywords:["VP","CRO","retained search"], contacts:502, openRate:49, replyRate:12.1 },
  { industry:"Finance", sub:"Private credit", channel:"LinkedIn", keywords:["senior debt","unitranche","sponsor"], contacts:233, openRate:null, replyRate:11.8 },
  { industry:"Consulting", sub:"Strategy consulting", channel:"MultiChannel", keywords:["board","transformation","growth"], contacts:3750, openRate:46, replyRate:11.4 },
  { industry:"Manufacturing", sub:"Industrial automation", channel:"Email", keywords:["OEM","integration","ROI"], contacts:4880, openRate:38, replyRate:11.1 },
  { industry:"Legal", sub:"Employment law", channel:"Email", keywords:["HR","compliance","handbook"], contacts:2210, openRate:35, replyRate:10.8 },
  { industry:"Healthcare", sub:"Health tech", channel:"MultiChannel", keywords:["EHR","interoperability","CIO"], contacts:3470, openRate:41, replyRate:10.5 },
  { industry:"Finance", sub:"Wealth management", channel:"LinkedIn", keywords:["AUM","HNW","fee-only"], contacts:356, openRate:null, replyRate:10.2 },
  { industry:"M&A", sub:"Business brokerage", channel:"Email", keywords:["main street","SBA","owner-op"], contacts:1940, openRate:33, replyRate:9.9 },
  { industry:"Real Estate", sub:"CRE capital markets", channel:"MultiChannel", keywords:["NOI","cap rate","sponsor"], contacts:4120, openRate:43, replyRate:9.7 },
  { industry:"Consulting", sub:"HR consulting", channel:"Email", keywords:["talent","engagement","CHRO"], contacts:2680, openRate:37, replyRate:9.4 },
  { industry:"Manufacturing", sub:"Aerospace & defense", channel:"LinkedIn", keywords:["ITAR","Tier 1","RFQ"], contacts:1370, openRate:null, replyRate:9.2 },
  { industry:"Legal", sub:"IP law", channel:"Email", keywords:["patent","trademark","licensing"], contacts:321, openRate:40, replyRate:9.0 },
  { industry:"Finance", sub:"Insurance", channel:"MultiChannel", keywords:["risk","broker","premium"], contacts:4960, openRate:35, replyRate:8.8 },
  { industry:"SaaS", sub:"Vertical SaaS", channel:"Email", keywords:["niche","SMB","PLG"], contacts:3820, openRate:29, replyRate:8.5 },
  { industry:"Healthcare", sub:"Behavioral health", channel:"LinkedIn", keywords:["telehealth","billing","SUD"], contacts:2090, openRate:null, replyRate:8.3 },
  { industry:"Recruiting", sub:"Technical recruiting", channel:"MultiChannel", keywords:["eng","staff aug","contract"], contacts:4710, openRate:44, replyRate:8.1 },
  { industry:"Real Estate", sub:"PropTech", channel:"Email", keywords:["valuation","underwriting","API"], contacts:1580, openRate:31, replyRate:7.9 },
  { industry:"Finance", sub:"Accounting firms", channel:"LinkedIn", keywords:["CFO","audit","M&A support"], contacts:3300, openRate:null, replyRate:7.7 },
  { industry:"Consulting", sub:"IT consulting", channel:"MultiChannel", keywords:["cloud","migration","MSP"], contacts:4850, openRate:34, replyRate:7.5 },
  { industry:"Manufacturing", sub:"Food & beverage", channel:"Email", keywords:["co-packer","SKU","retail"], contacts:2430, openRate:38, replyRate:7.3 },
  { industry:"SaaS", sub:"Sales tech", channel:"MultiChannel", keywords:["CRM","AI SDR","pipeline"], contacts:4990, openRate:27, replyRate:7.1 },
  { industry:"Legal", sub:"Real estate law", channel:"LinkedIn", keywords:["title","closing","lender"], contacts:1740, openRate:null, replyRate:6.9 },
  { industry:"Healthcare", sub:"Dental DSO", channel:"Email", keywords:["DSO","acquisition","PPO"], contacts:2860, openRate:36, replyRate:6.8 },
  { industry:"Finance", sub:"Family office", channel:"LinkedIn", keywords:["direct invest","co-invest","LP"], contacts:168, openRate:null, replyRate:6.6 },
  { industry:"Real Estate", sub:"Multifamily", channel:"Email", keywords:["cap rate","NOI","refi"], contacts:3940, openRate:30, replyRate:6.4 },
  { industry:"SaaS", sub:"HR tech", channel:"MultiChannel", keywords:["HRIS","payroll","ATS"], contacts:4780, openRate:28, replyRate:6.2 },
  { industry:"Recruiting", sub:"Sales recruiting", channel:"Email", keywords:["AE","BDR","quota"], contacts:3150, openRate:39, replyRate:6.1 },
  { industry:"Manufacturing", sub:"Packaging", channel:"LinkedIn", keywords:["sustainable","CPG","converter"], contacts:2490, openRate:null, replyRate:5.9 },
  { industry:"Consulting", sub:"Marketing consulting", channel:"MultiChannel", keywords:["CMO","demand gen","ABM"], contacts:4630, openRate:32, replyRate:5.8 },
  { industry:"Finance", sub:"Fintech", channel:"Email", keywords:["payments","embedded","API"], contacts:4870, openRate:26, replyRate:5.6 },
  { industry:"SaaS", sub:"MarTech", channel:"MultiChannel", keywords:["CDP","attribution","GA4"], contacts:5000, openRate:null, replyRate:5.4 },
  { industry:"Real Estate", sub:"Net lease", channel:"Email", keywords:["NNN","cap rate","1031"], contacts:1920, openRate:33, replyRate:5.2 },
  { industry:"Legal", sub:"Corporate law", channel:"MultiChannel", keywords:["general counsel","compliance","board"], contacts:3460, openRate:31, replyRate:5.1 },
  { industry:"Healthcare", sub:"Pharma", channel:"Email", keywords:["biopharma","formulary","payer"], contacts:4740, openRate:null, replyRate:4.9 },
  { industry:"SaaS", sub:"DevTools", channel:"Email", keywords:["API","SDK","developer"], contacts:4920, openRate:22, replyRate:4.7 },
  { industry:"Manufacturing", sub:"Chemicals", channel:"LinkedIn", keywords:["specialty chem","distribution","REACH"], contacts:3280, openRate:null, replyRate:4.6 },
  { industry:"Recruiting", sub:"Healthcare staffing", channel:"MultiChannel", keywords:["travel nurse","locum","agency"], contacts:4550, openRate:null, replyRate:4.4 },
  { industry:"Finance", sub:"Tax advisory", channel:"Email", keywords:["R&D credit","cost seg","SALT"], contacts:2670, openRate:30, replyRate:4.2 },
  { industry:"SaaS", sub:"Security", channel:"MultiChannel", keywords:["SOC2","SIEM","zero trust"], contacts:4830, openRate:25, replyRate:4.1 },
  { industry:"Real Estate", sub:"Industrial REIT", channel:"Email", keywords:["logistics","last mile","e-comm"], contacts:3710, openRate:null, replyRate:3.9 },
  { industry:"SaaS", sub:"Analytics", channel:"Email", keywords:["BI","warehouse","Snowflake"], contacts:4960, openRate:21, replyRate:3.7 },
];

const industries = ['All', 'M&A', 'Consulting', 'Healthcare', 'Legal', 'SaaS', 'Finance'] as const;
const channels = ['All', 'LinkedIn', 'Email', 'MultiChannel'] as const;

const channelBadgeClass: Record<string, string> = {
  LinkedIn: 'bg-blue-500/15 text-blue-700 border-blue-500/25',
  Email: 'bg-green-500/15 text-green-700 border-green-500/25',
  MultiChannel: 'bg-amber-500/15 text-amber-700 border-amber-500/25',
};

function replyRateClass(rate: number) {
  if (rate >= 12) return 'text-green-600 font-semibold';
  if (rate >= 7) return 'text-blue-600 font-medium';
  return 'text-muted-foreground';
}

const medals = ['🥇', '🥈', '🥉'];

interface LeaderboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeaderboardDialog({ open, onOpenChange }: LeaderboardDialogProps) {
  const [industryFilter, setIndustryFilter] = useState<string>('All');
  const [channelFilter, setChannelFilter] = useState<string>('All');

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (industryFilter !== 'All' && c.industry !== industryFilter) return false;
      if (channelFilter !== 'All' && c.channel !== channelFilter) return false;
      return true;
    });
  }, [industryFilter, channelFilter]);

  const maxReplyRate = filtered.length > 0 ? Math.max(...filtered.map((c) => c.replyRate)) : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Campaign Leaderboard
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border">
          <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Completely anonymous — no campaign names, team info, or personal data shown
          </p>
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground w-14 shrink-0">Industry</span>
            {industries.map((ind) => (
              <button
                key={ind}
                onClick={() => setIndustryFilter(ind)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  industryFilter === ind
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                }`}
              >
                {ind}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground w-14 shrink-0">Channel</span>
            {channels.map((ch) => (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  channelFilter === ch
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="h-[500px]">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Trophy className="h-8 w-8 mb-2 opacity-50" />
              <p>No campaigns match the selected filters</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Keywords</TableHead>
                  <TableHead className="text-right">Contacts</TableHead>
                  <TableHead className="text-right">Open rate</TableHead>
                  <TableHead className="text-right">Reply rate</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c, i) => {
                  const rank = i + 1;
                  const barWidth = (c.replyRate / maxReplyRate) * 100;
                  return (
                    <TableRow key={`${c.industry}-${c.sub}-${c.channel}`}>
                      <TableCell className="font-medium text-center">
                        {rank <= 3 ? (
                          <span className="text-base">{medals[rank - 1]}</span>
                        ) : (
                          <span className="text-muted-foreground">{rank}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{c.industry}</span>
                          <span className="text-xs text-muted-foreground">{c.sub}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] ${channelBadgeClass[c.channel]}`}>
                          {c.channel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.keywords.map((kw) => (
                            <span
                              key={kw}
                              className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.contacts.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.openRate !== null ? `${c.openRate}%` : '—'}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${replyRateClass(c.replyRate)}`}>
                        {c.replyRate}%
                      </TableCell>
                      <TableCell>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              c.replyRate >= 12 ? 'bg-green-500' : c.replyRate >= 7 ? 'bg-blue-500' : 'bg-muted-foreground/40'
                            }`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        <p className="text-xs text-muted-foreground text-center pt-2 border-t">
          Rankings based on reply rate. Top 50 campaigns across all platform users.
        </p>
      </DialogContent>
    </Dialog>
  );
}
