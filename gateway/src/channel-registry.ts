/**
 * Channel Registry — Follow-the-Sun Delivery
 *
 * Tracks all connected surfaces (Telegram, web-voice, Claude-voice, etc.)
 * and provides routing logic for heartbeat delivery. Claire sees the landscape
 * and decides where to send — this registry executes her decision.
 *
 * Channel types:
 *   - persistent: Always reachable (Telegram). Messages queue server-side.
 *   - session: Only alive while connected (web-voice, Claude-voice).
 *
 * Follow-the-sun routing (used when Claire says [SEND] without specifying):
 *   1. Session channels with activity in the last 30 minutes
 *   2. Any connected session channels
 *   3. Persistent channels (always-on fallback)
 */

export type ChannelType = 'persistent' | 'session';

export interface ChannelRegistration {
  name: string;
  type: ChannelType;
  deliver: (message: string) => Promise<boolean>;
}

interface ChannelInfo extends ChannelRegistration {
  connected: boolean;
  lastActivity: Date | null;
}

export class ChannelRegistry {
  private channels = new Map<string, ChannelInfo>();

  register(registration: ChannelRegistration): void {
    const existing = this.channels.get(registration.name);
    this.channels.set(registration.name, {
      ...registration,
      connected: true,
      lastActivity: existing?.lastActivity ?? null,
    });
    console.log(`[channel-registry] Registered: ${registration.name} (${registration.type})`);
  }

  deregister(name: string): void {
    const ch = this.channels.get(name);
    if (ch) {
      ch.connected = false;
      console.log(`[channel-registry] Deregistered: ${name}`);
    }
  }

  updateActivity(name: string): void {
    const ch = this.channels.get(name);
    if (ch) {
      ch.lastActivity = new Date();
    }
  }

  /**
   * Build the channel status text injected into heartbeat triggers.
   * Claire reads this to decide where to send.
   */
  getChannelStatusText(): string {
    const entries = Array.from(this.channels.values());
    if (entries.length === 0) return 'No channels registered.';

    const parts = entries.map(ch => {
      const status = ch.connected ? 'connected' : 'disconnected';
      const activityNote = ch.lastActivity
        ? `last active ${minutesAgo(ch.lastActivity)}m ago`
        : 'no recent activity';
      return `${ch.name} (${ch.type}, ${status}, ${activityNote})`;
    });

    return `Channels: ${parts.join('; ')}.`;
  }

  /**
   * Deliver to a specific named channel.
   */
  async deliver(channelName: string, message: string): Promise<boolean> {
    const ch = this.channels.get(channelName);
    if (!ch || !ch.connected) {
      console.error(`[channel-registry] Cannot deliver to ${channelName}: not connected`);
      // If it's a persistent channel that just appeared disconnected, try anyway
      if (ch?.type === 'persistent') {
        console.log(`[channel-registry] Attempting delivery to persistent channel despite disconnected flag`);
        return await ch.deliver(message);
      }
      return false;
    }
    return await ch.deliver(message);
  }

  /**
   * Follow-the-sun delivery: route to the most appropriate channel.
   * Used when Claire says [SEND] without specifying a channel name.
   *
   * Priority:
   *   1. Session channels active in the last 30 minutes
   *   2. Any connected session channels
   *   3. Persistent channels (always-on fallback)
   */
  async deliverFollowTheSun(
    message: string
  ): Promise<{ channel: string; success: boolean } | null> {
    const all = Array.from(this.channels.values());

    const recentSessions = all.filter(
      ch =>
        ch.type === 'session' &&
        ch.connected &&
        ch.lastActivity &&
        minutesAgo(ch.lastActivity) < 30
    );

    const anySessions = all.filter(ch => ch.type === 'session' && ch.connected);
    const persistent = all.filter(ch => ch.type === 'persistent' && ch.connected);

    const target = recentSessions[0] || anySessions[0] || persistent[0];
    if (!target) return null;

    const success = await target.deliver(message);
    return { channel: target.name, success };
  }

  getAll(): ChannelInfo[] {
    return Array.from(this.channels.values());
  }

  isConnected(name: string): boolean {
    return this.channels.get(name)?.connected ?? false;
  }
}

function minutesAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 60000);
}

// Process-level singleton shared by gateway, heartbeat, and MCP server
export const channelRegistry = new ChannelRegistry();
