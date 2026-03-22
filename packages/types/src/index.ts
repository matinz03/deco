// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  publicKey: string; // E2E public key
  bio: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface UserPresence {
  userId: string;
  status: "online" | "offline" | "busy" | "away";
  lastSeenAt: string;
}

// ─── Conversation ─────────────────────────────────────────────────────────────

export type ConversationType = "direct" | "group" | "channel";

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string;
  avatarUrl: string;
  description: string;
  createdById: string;
  lastMessage?: Message;
  unreadCount: number;
  memberCount: number;
  members?: Member[];
  createdAt: string;
  updatedAt: string;
}

// ─── Message ──────────────────────────────────────────────────────────────────

export type MessageType = "text" | "image" | "video" | "audio" | "file" | "system";
export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export type UploadKind = "avatar" | "image" | "video" | "audio" | "file";

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  sender?: User;
  type: MessageType;
  // encryptedContent: ciphertext stored on server, decrypted client-side
  encryptedContent: string;
  // decryptedContent: populated client-side after decryption, never sent to server
  decryptedContent?: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  replyToId?: string;
  replyTo?: Message;
  reactions: Reaction[];
  status: MessageStatus;
  isEdited: boolean;
  isDeleted: boolean;
  sentAt: string;
  editedAt?: string;
}

// ─── Reaction ─────────────────────────────────────────────────────────────────

export interface Reaction {
  messageId: string;
  userId: string;
  user?: User;
  emoji: string;
  createdAt: string;
}

// ─── Member ───────────────────────────────────────────────────────────────────

export type MemberRole = "owner" | "admin" | "member";

export interface Member {
  conversationId: string;
  userId: string;
  user?: User;
  role: MemberRole;
  joinedAt: string;
  lastReadAt: string;
}

// ─── WebSocket Events ─────────────────────────────────────────────────────────

export type WSEventType =
  | "message.new"
  | "message.edited"
  | "message.deleted"
  | "message.reaction"
  | "typing"
  | "presence"
  | "message.read";

export interface WSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
}

export interface TypingPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface PresencePayload {
  userId: string;
  status: UserPresence["status"];
  lastSeenAt?: string;
}

export interface ReadPayload {
  conversationId: string;
  userId: string;
  lastReadAt: string;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
}

export interface KeyBackupPayload {
  version: number;
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  cipher: "aes-gcm";
  iv: string;
  ciphertext: string;
}

export interface KeyBackupRecord extends KeyBackupPayload {
  createdAt: string;
  updatedAt: string;
}

export interface KeyBackupResponse {
  exists: boolean;
  backup?: KeyBackupRecord;
}

export interface UploadResponse {
  url: string;
  mimeType: string;
  size: number;
  name: string;
  kind: UploadKind;
}
