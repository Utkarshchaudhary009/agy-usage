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
          is_active: boolean | null;
          token_status: "active" | "expired" | "revoked" | null;
          added_at: string | null;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          clerk_user_id: string;
          email: string;
          display_name?: string | null;
          is_active?: boolean | null;
          token_status?: "active" | "expired" | "revoked" | null;
          added_at?: string | null;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          clerk_user_id?: string;
          email?: string;
          display_name?: string | null;
          is_active?: boolean | null;
          token_status?: "active" | "expired" | "revoked" | null;
          added_at?: string | null;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      google_tokens: {
        Row: {
          account_id: string;
          access_token_encrypted: string;
          refresh_token_encrypted: string;
          expires_at: string;
          project_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          account_id: string;
          access_token_encrypted: string;
          refresh_token_encrypted: string;
          expires_at: string;
          project_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          account_id?: string;
          access_token_encrypted?: string;
          refresh_token_encrypted?: string;
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
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
