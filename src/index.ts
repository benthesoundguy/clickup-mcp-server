#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupTaskTools } from './tools/task-tools.js';
import { setupDocTools } from './tools/doc-tools.js';
import { setupSpaceTools } from './tools/space-tools.js';
import { setupChecklistTools } from './tools/checklist-tools.js';
import { setupCommentTools } from './tools/comment-tools.js';
import { setupCustomFieldTools } from './tools/custom-field-tools.js';
import { setupCustomFieldValueTools } from './tools/custom-field-value-tools.js';
import { setupDependencyTools } from './tools/dependency-tools.js';
import { setupTagTools } from './tools/tag-tools.js';
import { setupViewTools } from './tools/view-tools.js';
import { setupGoalTools } from './tools/goal-tools.js';
import { setupWebhookTools } from './tools/webhook-tools.js';
import { setupGuestTools } from './tools/guest-tools.js';
import { setupChatTools } from './tools/chat-tools.js';
import { setupTimeTrackingTools } from './tools/time-tracking-tools.js';
import { setupUserTools } from './tools/user-tools.js';
import { setupGroupTools } from './tools/group-tools.js';
import { setupTemplateTools } from './tools/template-tools.js';
import { setupAttachmentTools } from './tools/attachment-tools.js';
import { setupReminderTools } from './tools/reminder-tools.js';
import { setupStatusTools } from './tools/status-tools.js';
import { setupProjectIntelligenceTools } from './tools/project-intelligence-tools.js';

// Environment variables are passed to the server through the MCP settings file
// See mcp-settings-example.json for an example

class ClickUpServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: 'clickup-mcp-server',
      version: '2.0.0',
    });
    
    // Handle process termination
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });

    // Prevent process crashes from unhandled errors
    process.on('unhandledRejection', (reason) => {
      console.error('[ClickUpServer] Unhandled rejection:', reason);
    });
    process.on('uncaughtException', (error) => {
      console.error('[ClickUpServer] Uncaught exception:', error);
    });

    // Set up tools
    this.setupTools();
  }

  private setupTools() {
    // Set up all tools
    setupTaskTools(this.server);
    setupDocTools(this.server);
    setupSpaceTools(this.server);
    setupChecklistTools(this.server);
    setupCommentTools(this.server);
    setupCustomFieldTools(this.server);
    setupCustomFieldValueTools(this.server);
    setupDependencyTools(this.server);
    setupTagTools(this.server);
    setupViewTools(this.server);
    setupGoalTools(this.server);
    setupWebhookTools(this.server);
    setupGuestTools(this.server);
    setupChatTools(this.server);
    setupTimeTrackingTools(this.server);
    setupUserTools(this.server);
    setupGroupTools(this.server);
    setupTemplateTools(this.server);
    setupAttachmentTools(this.server);
    setupReminderTools(this.server);
    setupStatusTools(this.server);
    setupProjectIntelligenceTools(this.server);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ClickUp MCP server running on stdio');
  }
}

// Create and run the server
const server = new ClickUpServer();
server.run().catch(console.error);
