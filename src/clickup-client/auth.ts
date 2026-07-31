import { ClickUpClient } from './index.js';

export interface AuthorizedUser {
  id: number;
  username: string;
  email: string;
  color: string;
  profilePicture: string;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  avatar: string;
  members: Array<{
    user: {
      id: number;
      username: string;
      email: string;
      color: string;
      profilePicture: string;
    };
    role: number;
    custom_role?: string;
  }>;
}

export class AuthClient {
  private client: ClickUpClient;

  constructor(client: ClickUpClient) {
    this.client = client;
  }

  /**
   * Get the authorized user's information
   * @returns The authorized user's information
   */
  async getAuthorizedUser(): Promise<AuthorizedUser> {
    try {
      return await this.client.get('/user');
    } catch (error) {
      console.error('Error getting authorized user:', error);
      throw error;
    }
  }

  /**
   * Get the workspaces (teams) that the authorized user belongs to
   * @returns A list of workspaces
   */
  async getWorkspaces(): Promise<{ teams: Workspace[] }> {
    try {
      return await this.client.get('/team');
    } catch (error) {
      console.error('Error getting workspaces:', error);
      throw error;
    }
  }

  /**
   * Get the seats information for a workspace
   * @param workspaceId The ID of the workspace to get seats information for
   * @returns Seats information including used, total, and available seats
   */
  async getWorkspaceSeats(workspaceId: string): Promise<{
    members: object;
    filled_members_seats: number;
    total_member_seats: number;
    empty_member_seats: number;
    guests: object;
    filled_guest_seats: number;
    total_guest_seats: number;
    empty_guest_seats: number;
  }> {
    try {
      return await this.client.get(`/team/${workspaceId}/seats`);
    } catch (error) {
      console.error('Error getting workspace seats:', error);
      throw error;
    }
  }
}

export const createAuthClient = (client: ClickUpClient): AuthClient => {
  return new AuthClient(client);
};
