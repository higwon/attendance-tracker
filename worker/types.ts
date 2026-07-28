export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

export type AppUser = {
  id: string;
  username: string;
  display_name: string;
  role: "user" | "admin";
  is_active: number;
  last_active_at: string | null;
  profile_photo: string | null;
};

export type Variables = {
  user: AppUser;
};
