export type UserRole = 'user' | 'admin';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
