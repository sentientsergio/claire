#!/usr/bin/env node

/**
 * CLI Client for claire
 * 
 * A simple REPL that connects to the gateway and allows chat interaction.
 */

import WebSocket from 'ws';
import * as readline from 'readline';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:18789';

interface Request {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface Response {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

interface Event {
  type: 'event';
  event: string;
  payload: {
    runId?: string;
    delta?: string;
    content?: string;
    done?: boolean;
  };
}

type Message = Response | Event;

let requestId = 0;
function generateId(): string {
  return `cli-${++requestId}-${Date.now()}`;
}

function parseMessage(data: string): Message | null {
  try {
    return JSON.parse(data) as Message;
  } catch {
    return null;
  }
}

class AssistantCLI {
  private ws: WebSocket | null = null;
  private rl: readline.Interface;
  private connected = false;
  private sessionId: string | null = null;
  private pendingResponse: ((response: Response) => void) | null = null;
  private isStreaming = false;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    console.log('Connecting to gateway...');
    
    try {
      await this.connect();
      console.log(`Connected! Session: ${this.sessionId}`);
      console.log('Type your message and press Enter. Type "exit" to quit.\n');
      this.prompt();
    } catch (err) {
      console.error('Failed to connect:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(GATEWAY_URL);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 10000);

      this.ws.on('open', async () => {
        clearTimeout(timeout);
        
        try {
          // Send connect request
          const response = await this.sendRequest('connect', {});
          
          if (response.ok && response.payload) {
            const payload = response.payload as { sessionId: string };
            this.sessionId = payload.sessionId;
            this.connected = true;
            resolve();
          } else {
            reject(new Error(response.error?.message || 'Connect failed'));
          }
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (data) => {
        const message = parseMessage(data.toString());
        if (!message) return;

        if (message.type === 'res') {
          // Response to a request
          if (this.pendingResponse) {
            this.pendingResponse(message);
            this.pendingResponse = null;
          }
        } else if (message.type === 'event') {
          this.handleEvent(message);
        }
      });

      this.ws.on('close', () => {
        if (this.connected) {
          console.log('\nDisconnected from gateway');
          process.exit(0);
        }
      });

      this.ws.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        } else {
          console.error('\nWebSocket error:', err.message);
        }
      });
    });
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<Response> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const request: Request = {
        type: 'req',
        id: generateId(),
        method,
        params,
      };

      this.pendingResponse = resolve;
      this.ws.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingResponse === resolve) {
          this.pendingResponse = null;
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  private handleEvent(event: Event): void {
    if (event.event === 'agent') {
      if (event.payload.delta) {
        // Streaming text
        if (!this.isStreaming) {
          this.isStreaming = true;
          process.stdout.write('\n');
        }
        process.stdout.write(event.payload.delta);
      }

      if (event.payload.done) {
        // Streaming complete
        this.isStreaming = false;
        process.stdout.write('\n\n');
        this.prompt();
      }
    }
  }

  private prompt(): void {
    this.rl.question('> ', async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        this.prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('Goodbye!');
        this.ws?.close();
        process.exit(0);
      }

      try {
        await this.sendRequest('agent', { message: trimmed });
        // Response handling continues in handleEvent for streaming
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        this.prompt();
      }
    });
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\nGoodbye!');
  process.exit(0);
});

// Start the CLI
const cli = new AssistantCLI();
cli.start().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
