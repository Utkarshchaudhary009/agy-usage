export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Result of `acquire_token_refresh_lease`.
 *
 * - `fresh`: a still-valid access token is already persisted; no lease taken.
 * - `locked`: another instance holds the lease; back off and retry.
 * - `granted`: this caller owns the lease and must release it with `lock_token`.
 */
export type TokenRefreshLease =
  | {
      outcome: "fresh";
      access_token: string | null;
      expires_at: string | null;
    }
  | {
      outcome: "locked";
      locked_until: string;
      expires_at: string | null;
    }
  | {
      outcome: "granted";
      lock_token: string;
      refresh_token: string | null;
      access_token: string | null;
      expires_at: string | null;
    };

export interface Database {
  public: {
    Tables: {
      google_accounts: {
        Row: {
          id: string;
          clerk_user_id: string;
          email: string;
          display_name: string | null;
          is_active: boolean;
          token_status: "active" | "expired" | "revoked";
          added_at: string;
          last_used_at: string;
        };
        Insert: {
          id?: string;
          clerk_user_id: string;
          email: string;
          display_name?: string | null;
          is_active?: boolean;
          token_status?: "active" | "expired" | "revoked";
          added_at?: string;
          last_used_at?: string;
        };
        Update: {
          id?: string;
          clerk_user_id?: string;
          email?: string;
          display_name?: string | null;
          is_active?: boolean;
          token_status?: "active" | "expired" | "revoked";
          added_at?: string;
          last_used_at?: string;
        };
        Relationships: [];
      };
      google_tokens: {
        Row: {
          account_id: string;
          access_token_secret_id: string;
          refresh_token_secret_id: string;
          expires_at: string;
          project_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          access_token_secret_id: string;
          refresh_token_secret_id: string;
          expires_at: string;
          project_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          access_token_secret_id?: string;
          refresh_token_secret_id?: string;
          expires_at?: string;
          project_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "google_tokens_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: true;
            referencedRelation: "google_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      quota_cache: {
        Row: {
          account_id: string;
          snapshot: Json;
          cached_at: string;
        };
        Insert: {
          account_id: string;
          snapshot: Json;
          cached_at?: string;
        };
        Update: {
          account_id?: string;
          snapshot?: Json;
          cached_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quota_cache_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: true;
            referencedRelation: "google_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      quota_snapshots: {
        Row: {
          id: string;
          account_id: string;
          timestamp: string;
          plan_type: string | null;
          prompt_credits_available: number | null;
          prompt_credits_monthly: number | null;
          snapshot_data: Json;
        };
        Insert: {
          id?: string;
          account_id: string;
          timestamp?: string;
          plan_type?: string | null;
          prompt_credits_available?: number | null;
          prompt_credits_monthly?: number | null;
          snapshot_data: Json;
        };
        Update: {
          id?: string;
          account_id?: string;
          timestamp?: string;
          plan_type?: string | null;
          prompt_credits_available?: number | null;
          prompt_credits_monthly?: number | null;
          snapshot_data?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "quota_snapshots_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "google_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      model_quota_history: {
        Row: {
          id: string;
          snapshot_id: string;
          model_id: string;
          label: string;
          remaining_percentage: number | null;
          is_exhausted: boolean | null;
          reset_time: string | null;
        };
        Insert: {
          id?: string;
          snapshot_id: string;
          model_id: string;
          label: string;
          remaining_percentage?: number | null;
          is_exhausted?: boolean | null;
          reset_time?: string | null;
        };
        Update: {
          id?: string;
          snapshot_id?: string;
          model_id?: string;
          label?: string;
          remaining_percentage?: number | null;
          is_exhausted?: boolean | null;
          reset_time?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "model_quota_history_snapshot_id_fkey";
            columns: ["snapshot_id"];
            isOneToOne: false;
            referencedRelation: "quota_snapshots";
            referencedColumns: ["id"];
          },
        ];
      };
      token_refresh_leases: {
        Row: {
          account_id: string;
          lock_token: string;
          locked_until: string;
          acquired_at: string;
        };
        Insert: {
          account_id: string;
          lock_token: string;
          locked_until: string;
          acquired_at?: string;
        };
        Update: {
          account_id?: string;
          lock_token?: string;
          locked_until?: string;
          acquired_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "token_refresh_leases_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: true;
            referencedRelation: "google_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      wakeup_configs: {
        Row: {
          id: string;
          clerk_user_id: string;
          enabled: boolean;
          selected_models: string[];
          selected_account_ids: string[];
          schedule_mode: "interval" | "daily" | "custom";
          interval_hours: number;
          daily_times: string[];
          cron_expression: string | null;
          custom_prompt: string;
          max_output_tokens: number;
          cooldown_minutes: number;
          wake_on_reset: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clerk_user_id: string;
          enabled?: boolean;
          selected_models?: string[];
          selected_account_ids?: string[];
          schedule_mode?: "interval" | "daily" | "custom";
          interval_hours?: number;
          daily_times?: string[];
          cron_expression?: string | null;
          custom_prompt?: string;
          max_output_tokens?: number;
          cooldown_minutes?: number;
          wake_on_reset?: boolean;
          updated_at?: string;
        };
        Update: {
          id?: string;
          clerk_user_id?: string;
          enabled?: boolean;
          selected_models?: string[];
          selected_account_ids?: string[];
          schedule_mode?: "interval" | "daily" | "custom";
          interval_hours?: number;
          daily_times?: string[];
          cron_expression?: string | null;
          custom_prompt?: string;
          max_output_tokens?: number;
          cooldown_minutes?: number;
          wake_on_reset?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      wakeup_logs: {
        Row: {
          id: string;
          clerk_user_id: string;
          account_id: string | null;
          model_id: string;
          trigger_source: "manual" | "scheduled" | "quota_reset";
          success: boolean;
          duration_ms: number | null;
          error: string | null;
          response_preview: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          clerk_user_id: string;
          account_id?: string | null;
          model_id: string;
          trigger_source: "manual" | "scheduled" | "quota_reset";
          success: boolean;
          duration_ms?: number | null;
          error?: string | null;
          response_preview?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          clerk_user_id?: string;
          account_id?: string | null;
          model_id?: string;
          trigger_source?: "manual" | "scheduled" | "quota_reset";
          success?: boolean;
          duration_ms?: number | null;
          error?: string | null;
          response_preview?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wakeup_logs_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "google_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      requesting_user_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      upsert_google_tokens: {
        Args: {
          p_account_id: string;
          p_access_token: string;
          p_refresh_token: string;
          p_expires_at: string;
        };
        Returns: undefined;
      };
      get_decrypted_access_token: {
        Args: {
          p_account_id: string;
        };
        Returns: string;
      };
      get_decrypted_refresh_token: {
        Args: {
          p_account_id: string;
        };
        Returns: string;
      };
      get_valid_token_metadata: {
        Args: {
          p_account_id: string;
        };
        Returns: {
          access_token: string;
          expires_at: string;
        } | null;
      };
      delete_account_with_tokens: {
        Args: {
          p_account_id: string;
        };
        Returns: undefined;
      };
      set_active_account: {
        Args: {
          p_account_id: string;
        };
        Returns: undefined;
      };
      acquire_token_refresh_lease: {
        Args: {
          p_account_id: string;
          p_ttl_seconds?: number;
          p_expiry_buffer_seconds?: number;
          p_force?: boolean;
        };
        Returns: TokenRefreshLease | null;
      };
      release_token_refresh_lease: {
        Args: {
          p_account_id: string;
          p_lock_token: string;
        };
        Returns: boolean;
      };
      begin_wakeup: {
        Args: {
          p_clerk_user_id: string;
          p_cooldown_minutes: number;
        };
        Returns: boolean;
      };
      get_wakeup_cooldown_remaining_ms: {
        Args: {
          p_clerk_user_id: string;
          p_cooldown_minutes: number;
        };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
