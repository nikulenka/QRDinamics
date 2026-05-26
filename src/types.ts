export interface Link {
  id: string;
  title?: string;
  destination: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  clicks?: number;
}
