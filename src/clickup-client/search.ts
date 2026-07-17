import { ClickUpClient } from './index.js';

export function createSearchClient(client: ClickUpClient) {
  return {
    async searchWorkspace(teamId: string, params: {
      query?: string;
      locations?: string[];
      types?: string[];
      page?: number;
      per_page?: number;
      modified_after?: number;
    }): Promise<any> {
      return client.post(`/team/${teamId}/search`, params);
    }
  };
}
