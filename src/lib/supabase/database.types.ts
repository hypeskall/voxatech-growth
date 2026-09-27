// Generated from the validated SQL migrations. Regenerate after schema changes.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string | null;
          actor_id: string | null;
          action: string;
          entity_table: string | null;
          entity_id: string | null;
          model: string | null;
          details: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id?: string | null;
          actor_id?: string | null;
          action: string;
          entity_table?: string | null;
          entity_id?: string | null;
          model?: string | null;
          details?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string | null;
          actor_id?: string | null;
          action?: string;
          entity_table?: string | null;
          entity_id?: string | null;
          model?: string | null;
          details?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      automation_jobs: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string | null;
          kind: string;
          status: string;
          payload: Json;
          idempotency_key: string;
          next_action_at: string;
          attempts: number;
          max_attempts: number;
          locked_until: string | null;
          lock_token: string | null;
          last_error: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id?: string | null;
          kind: string;
          status?: string;
          payload?: Json;
          idempotency_key: string;
          next_action_at?: string;
          attempts?: number;
          max_attempts?: number;
          locked_until?: string | null;
          lock_token?: string | null;
          last_error?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string | null;
          kind?: string;
          status?: string;
          payload?: Json;
          idempotency_key?: string;
          next_action_at?: string;
          attempts?: number;
          max_attempts?: number;
          locked_until?: string | null;
          lock_token?: string | null;
          last_error?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      campaign_leads: {
        Row: {
          id: string;
          organization_id: string;
          campaign_id: string;
          lead_id: string;
          step: number;
          next_action_at: string | null;
          stopped_at: string | null;
          stop_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          campaign_id: string;
          lead_id: string;
          step?: number;
          next_action_at?: string | null;
          stopped_at?: string | null;
          stop_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          campaign_id?: string;
          lead_id?: string;
          step?: number;
          next_action_at?: string | null;
          stopped_at?: string | null;
          stop_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      campaigns: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          niche: string | null;
          cities: string[];
          target_filters: Json;
          sender_identity: string | null;
          tone: string;
          offer: string | null;
          daily_cap: number;
          window_start: string;
          window_end: string;
          timezone: string;
          weekdays_only: boolean;
          max_follow_ups: number;
          first_message: string | null;
          follow_up_1: string | null;
          follow_up_2: string | null;
          mode: string;
          status: string;
          activated_by: string | null;
          activated_at: string | null;
          created_at: string;
          updated_at: string;
          next_send_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          niche?: string | null;
          cities?: string[];
          target_filters?: Json;
          sender_identity?: string | null;
          tone?: string;
          offer?: string | null;
          daily_cap?: number;
          window_start?: string;
          window_end?: string;
          timezone?: string;
          weekdays_only?: boolean;
          max_follow_ups?: number;
          first_message?: string | null;
          follow_up_1?: string | null;
          follow_up_2?: string | null;
          mode?: string;
          status?: string;
          activated_by?: string | null;
          activated_at?: string | null;
          created_at?: string;
          updated_at?: string;
          next_send_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          niche?: string | null;
          cities?: string[];
          target_filters?: Json;
          sender_identity?: string | null;
          tone?: string;
          offer?: string | null;
          daily_cap?: number;
          window_start?: string;
          window_end?: string;
          timezone?: string;
          weekdays_only?: boolean;
          max_follow_ups?: number;
          first_message?: string | null;
          follow_up_1?: string | null;
          follow_up_2?: string | null;
          mode?: string;
          status?: string;
          activated_by?: string | null;
          activated_at?: string | null;
          created_at?: string;
          updated_at?: string;
          next_send_at?: string | null;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          channel: string;
          provider_thread_id: string | null;
          summary: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          channel?: string;
          provider_thread_id?: string | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          channel?: string;
          provider_thread_id?: string | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      demos: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          status: string;
          script: Json | null;
          storage_path: string | null;
          duration_seconds: number | null;
          share_token: string;
          expires_at: string | null;
          revoked_at: string | null;
          idempotency_key: string;
          model: string | null;
          created_at: string;
          updated_at: string;
          audio_segments: Json;
          viewed_at: string | null;
          listened_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          status?: string;
          script?: Json | null;
          storage_path?: string | null;
          duration_seconds?: number | null;
          share_token?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          idempotency_key: string;
          model?: string | null;
          created_at?: string;
          updated_at?: string;
          audio_segments?: Json;
          viewed_at?: string | null;
          listened_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          status?: string;
          script?: Json | null;
          storage_path?: string | null;
          duration_seconds?: number | null;
          share_token?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          idempotency_key?: string;
          model?: string | null;
          created_at?: string;
          updated_at?: string;
          audio_segments?: Json;
          viewed_at?: string | null;
          listened_at?: string | null;
        };
        Relationships: [];
      };
      integrations: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          enabled: boolean;
          public_config: Json;
          last_verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider: string;
          enabled?: boolean;
          public_config?: Json;
          last_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          enabled?: boolean;
          public_config?: Json;
          last_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_base_documents: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          category: string;
          content: string;
          active: boolean;
          version: number;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          title: string;
          category: string;
          content: string;
          active?: boolean;
          version?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          title?: string;
          category?: string;
          content?: string;
          active?: boolean;
          version?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      knowledge_base_versions: {
        Row: {
          id: string;
          organization_id: string;
          document_id: string;
          title: string;
          content: string;
          category: string;
          version: number;
          edited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          document_id: string;
          title: string;
          content: string;
          category: string;
          version: number;
          edited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          document_id?: string;
          title?: string;
          content?: string;
          category?: string;
          version?: number;
          edited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lead_contacts: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          name: string | null;
          email: string | null;
          phone: string | null;
          position: string | null;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
          position?: string | null;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
          position?: string | null;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          organization_id: string;
          company_name: string;
          niche: string | null;
          city: string | null;
          country: string;
          website: string | null;
          email: string | null;
          phone: string | null;
          contact_name: string | null;
          source: string;
          services: Json;
          opening_hours: Json | null;
          google_rating: number | null;
          review_count: number | null;
          lead_score: number | null;
          score_reasons: Json;
          lead_temperature: string | null;
          personalization_fact: string | null;
          website_summary: string | null;
          status: Database["public"]["Enums"]["lead_status"];
          owner_id: string | null;
          last_contact_at: string | null;
          next_action_at: string | null;
          do_not_contact: boolean;
          notes: string;
          conversation_summary: string | null;
          revenue_won: number;
          currency: string;
          normalized_email: string | null;
          normalized_phone: string | null;
          normalized_website: string | null;
          normalized_company_city: string | null;
          created_at: string;
          updated_at: string;
          enriched_at: string | null;
          verified_facts: Json;
        };
        Insert: {
          id?: string;
          organization_id: string;
          company_name: string;
          niche?: string | null;
          city?: string | null;
          country?: string;
          website?: string | null;
          email?: string | null;
          phone?: string | null;
          contact_name?: string | null;
          source?: string;
          services?: Json;
          opening_hours?: Json | null;
          google_rating?: number | null;
          review_count?: number | null;
          lead_score?: number | null;
          score_reasons?: Json;
          lead_temperature?: string | null;
          personalization_fact?: string | null;
          website_summary?: string | null;
          status?: Database["public"]["Enums"]["lead_status"];
          owner_id?: string | null;
          last_contact_at?: string | null;
          next_action_at?: string | null;
          do_not_contact?: boolean;
          notes?: string;
          conversation_summary?: string | null;
          revenue_won?: number;
          currency?: string;
          normalized_email?: never;
          normalized_phone?: never;
          normalized_website?: never;
          normalized_company_city?: never;
          created_at?: string;
          updated_at?: string;
          enriched_at?: string | null;
          verified_facts?: Json;
        };
        Update: {
          id?: string;
          organization_id?: string;
          company_name?: string;
          niche?: string | null;
          city?: string | null;
          country?: string;
          website?: string | null;
          email?: string | null;
          phone?: string | null;
          contact_name?: string | null;
          source?: string;
          services?: Json;
          opening_hours?: Json | null;
          google_rating?: number | null;
          review_count?: number | null;
          lead_score?: number | null;
          score_reasons?: Json;
          lead_temperature?: string | null;
          personalization_fact?: string | null;
          website_summary?: string | null;
          status?: Database["public"]["Enums"]["lead_status"];
          owner_id?: string | null;
          last_contact_at?: string | null;
          next_action_at?: string | null;
          do_not_contact?: boolean;
          notes?: string;
          conversation_summary?: string | null;
          revenue_won?: number;
          currency?: string;
          normalized_email?: never;
          normalized_phone?: never;
          normalized_website?: never;
          normalized_company_city?: never;
          created_at?: string;
          updated_at?: string;
          enriched_at?: string | null;
          verified_facts?: Json;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          conversation_id: string | null;
          campaign_id: string | null;
          direction: string;
          channel: string;
          subject: string | null;
          body: string;
          status: string;
          provider: string | null;
          provider_message_id: string | null;
          idempotency_key: string;
          in_reply_to: string | null;
          follow_up_number: number | null;
          approved_by: string | null;
          approved_at: string | null;
          sent_at: string | null;
          received_at: string | null;
          model: string | null;
          classification: string | null;
          knowledge_document_ids: string[];
          metadata: Json;
          created_at: string;
          updated_at: string;
          reserved_at: string | null;
          unsubscribe_token: string;
          reply_token: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          conversation_id?: string | null;
          campaign_id?: string | null;
          direction: string;
          channel?: string;
          subject?: string | null;
          body: string;
          status?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          idempotency_key: string;
          in_reply_to?: string | null;
          follow_up_number?: number | null;
          approved_by?: string | null;
          approved_at?: string | null;
          sent_at?: string | null;
          received_at?: string | null;
          model?: string | null;
          classification?: string | null;
          knowledge_document_ids?: string[];
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
          reserved_at?: string | null;
          unsubscribe_token?: string;
          reply_token?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          conversation_id?: string | null;
          campaign_id?: string | null;
          direction?: string;
          channel?: string;
          subject?: string | null;
          body?: string;
          status?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          idempotency_key?: string;
          in_reply_to?: string | null;
          follow_up_number?: number | null;
          approved_by?: string | null;
          approved_at?: string | null;
          sent_at?: string | null;
          received_at?: string | null;
          model?: string | null;
          classification?: string | null;
          knowledge_document_ids?: string[];
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
          reserved_at?: string | null;
          unsubscribe_token?: string;
          reply_token?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          organization_id: string;
          recipient_id: string | null;
          title: string;
          body: string;
          read_at: string | null;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          recipient_id?: string | null;
          title: string;
          body: string;
          read_at?: string | null;
          idempotency_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          recipient_id?: string | null;
          title?: string;
          body?: string;
          read_at?: string | null;
          idempotency_key?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      onboarding_records: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          status: string;
          clinic_data: Json;
          services: Json;
          schedule: Json;
          preferred_greeting: string | null;
          transfer_rules: string | null;
          appointment_rules: string | null;
          calendar_setup: Json;
          contact_person: Json;
          payment_provider: string | null;
          payment_reference: string | null;
          amount_paid: number | null;
          currency: string;
          created_at: string;
          updated_at: string;
          share_token: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          status?: string;
          clinic_data?: Json;
          services?: Json;
          schedule?: Json;
          preferred_greeting?: string | null;
          transfer_rules?: string | null;
          appointment_rules?: string | null;
          calendar_setup?: Json;
          contact_person?: Json;
          payment_provider?: string | null;
          payment_reference?: string | null;
          amount_paid?: number | null;
          currency?: string;
          created_at?: string;
          updated_at?: string;
          share_token?: string;
          expires_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          status?: string;
          clinic_data?: Json;
          services?: Json;
          schedule?: Json;
          preferred_greeting?: string | null;
          transfer_rules?: string | null;
          appointment_rules?: string | null;
          calendar_setup?: Json;
          contact_person?: Json;
          payment_provider?: string | null;
          payment_reference?: string | null;
          amount_paid?: number | null;
          currency?: string;
          created_at?: string;
          updated_at?: string;
          share_token?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["member_role"];
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["member_role"];
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["member_role"];
          created_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          id: string;
          organization_id: string;
          key: string;
          value: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          key: string;
          value: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          key?: string;
          value?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      suppression_list: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string | null;
          channel: string;
          identifier: string;
          reason: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id?: string | null;
          channel: string;
          identifier: string;
          reason: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string | null;
          channel?: string;
          identifier?: string;
          reason?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string | null;
          title: string;
          description: string | null;
          assigned_to: string | null;
          status: string;
          due_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id?: string | null;
          title: string;
          description?: string | null;
          assigned_to?: string | null;
          status?: string;
          due_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string | null;
          title?: string;
          description?: string | null;
          assigned_to?: string | null;
          status?: string;
          due_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          event_id: string;
          event_type: string;
          payload: Json;
          processed_at: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider: string;
          event_id: string;
          event_type: string;
          payload?: Json;
          processed_at?: string | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          event_id?: string;
          event_type?: string;
          payload?: Json;
          processed_at?: string | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      daily_metrics: { Args: { org: string; day?: string }; Returns: Json };
      schedule_due_jobs: {
        Args: { target_org?: string; delivery_mode?: string };
        Returns: undefined;
      };
      claim_organization_job: {
        Args: { target_org?: string };
        Returns: Database["public"]["Tables"]["automation_jobs"]["Row"][];
      };
      defer_automation_job: {
        Args: { job_id: string; token: string };
        Returns: boolean;
      };
      reserve_outbound_message: {
        Args: { message_id: string };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      simulate_outbound_message: {
        Args: { message_id: string };
        Returns: Database["public"]["Tables"]["messages"]["Row"][];
      };
      assign_leads_to_campaign: {
        Args: { org: string; target_campaign: string; target_leads: string[] };
        Returns: number;
      };
      suppress_lead: {
        Args: { org: string; target: string; reason_text: string };
        Returns: undefined;
      };
      apply_payment: {
        Args: {
          org: string;
          target: string;
          reference: string;
          amount: number;
          currency_code: string;
        };
        Returns: string;
      };
      claim_automation_jobs: {
        Args: { batch_size?: number };
        Returns: Database["public"]["Tables"]["automation_jobs"]["Row"][];
      };
      finish_automation_job: {
        Args: { job_id: string; token: string; failure?: string | null };
        Returns: boolean;
      };
    };
    Enums: {
      lead_status:
        | "NEW"
        | "ENRICHING"
        | "READY_FOR_OUTREACH"
        | "CONTACTED"
        | "FOLLOW_UP_1"
        | "FOLLOW_UP_2"
        | "REPLIED"
        | "QUALIFIED"
        | "DEMO_GENERATING"
        | "DEMO_SENT"
        | "TRIAL"
        | "CHECKOUT_SENT"
        | "WON"
        | "LOST"
        | "HUMAN_REQUIRED"
        | "DO_NOT_CONTACT";
      member_role: "owner" | "admin" | "operator" | "viewer";
    };
    CompositeTypes: Record<string, never>;
  };
};
