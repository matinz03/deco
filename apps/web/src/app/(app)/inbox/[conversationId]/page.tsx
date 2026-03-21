import { ChatPanel } from "@/components/chat/ChatPanel";

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;
  return <ChatPanel conversationId={conversationId} />;
}
