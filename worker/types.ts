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
};

export type Variables = {
  user: AppUser;
};
