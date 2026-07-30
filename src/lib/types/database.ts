export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
