import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChannelMetrics {
  // Step counts by type
  emailSteps: number;
  linkedinConnectSteps: number;
  linkedinMessageSteps: number;
  linkedinViewSteps: number;
  linkedinInmailSteps: number;
  callSteps: number;
  manualTaskSteps: number;
  otherSteps: number;
  
  // Aggregated counts for display
  totalEmailSteps: number;
  totalLinkedInSteps: number;
}

export function useChannelMetrics() {
  return useQuery({
    queryKey: ['channel-metrics'],
    queryFn: async (): Promise<ChannelMetrics> => {
      const { data: sequences, error } = await supabase
        .from('synced_sequences')
        .select('step_type');

      if (error) throw error;

      // Count steps by type
      let emailSteps = 0;
      let linkedinConnectSteps = 0;
      let linkedinMessageSteps = 0;
      let linkedinViewSteps = 0;
      let linkedinInmailSteps = 0;
      let callSteps = 0;
      let manualTaskSteps = 0;
      let otherSteps = 0;

      sequences?.forEach((seq) => {
        const stepType = (seq.step_type || '').toLowerCase();
        
        if (stepType === 'email') {
          emailSteps++;
        } else if (stepType === 'linkedin_connect' || stepType === 'linkedinconnect') {
          linkedinConnectSteps++;
        } else if (stepType === 'linkedin_message' || stepType === 'linkedinmessage') {
          linkedinMessageSteps++;
        } else if (stepType === 'linkedin_view_profile' || stepType === 'linkedinviewprofile') {
          linkedinViewSteps++;
        } else if (stepType === 'linkedin_inmail' || stepType === 'linkedininmail') {
          linkedinInmailSteps++;
        } else if (stepType === 'call') {
          callSteps++;
        } else if (stepType === 'manual_task' || stepType === 'manualtask') {
          manualTaskSteps++;
        } else if (stepType) {
          otherSteps++;
        }
      });

      const totalLinkedInSteps = linkedinConnectSteps + linkedinMessageSteps + linkedinViewSteps + linkedinInmailSteps;

      return {
        emailSteps,
        linkedinConnectSteps,
        linkedinMessageSteps,
        linkedinViewSteps,
        linkedinInmailSteps,
        callSteps,
        manualTaskSteps,
        otherSteps,
        totalEmailSteps: emailSteps,
        totalLinkedInSteps,
      };
    },
  });
}
