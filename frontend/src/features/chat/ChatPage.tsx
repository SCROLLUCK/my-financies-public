import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Title,
  TypographyStylesProvider,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconPlus,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../../lib/api";
import { confirmDelete } from "../../lib/confirmDelete";
import { formatDateTime, formatTime } from "../../lib/format";
import type { ChatMessage, ChatResponse, Conversation, ConversationDetail } from "../../api/types";

// A gap this long since the previous message means the user stepped away and
// came back later — show a "returned at" badge marking that point.
const RETURN_GAP_MS = 30 * 60 * 1000;

export function ChatPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const [input, setInput] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  // Mobile only: the list and the active chat don't fit side by side, so show
  // one panel at a time — picking/starting a conversation navigates to it,
  // a back button returns to the list. Desktop ignores this (both show).
  const [mobileShowList, setMobileShowList] = useState(true);

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<Conversation[]>("/conversations/"),
  });

  const { data: activeConversation } = useQuery({
    queryKey: ["conversation", activeId],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${activeId}/`),
    enabled: activeId != null,
  });

  const baseMessages: ChatMessage[] =
    activeConversation && activeConversation.id === activeId ? activeConversation.messages : [];
  const messages: ChatMessage[] = pendingUserMessage
    ? [...baseMessages, pendingUserMessage]
    : baseMessages;

  useEffect(() => {
    viewportRef.current?.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (values: { message: string; conversation_id: number | null }) =>
      api.post<ChatResponse>("/chat/", values),
    onSuccess: async (res) => {
      setActiveId(res.conversation_id);
      // Wait for the real messages to land before dropping the optimistic
      // bubble, so it never flashes away before the fetched list has it.
      await qc.invalidateQueries({ queryKey: ["conversation", res.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setPendingUserMessage(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del(`/conversations/${id}/`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (activeId === id) newChat();
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    setPendingUserMessage({
      id: Date.now(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    });
    setInput("");
    sendMutation.mutate({ message: text, conversation_id: activeId });
  };

  const newChat = () => {
    setActiveId(null);
    setPendingUserMessage(null);
    setMobileShowList(false);
  };

  const openConversation = (id: number) => {
    setMobileShowList(false);
    if (id === activeId) return;
    setPendingUserMessage(null);
    setActiveId(id);
  };

  return (
    <Stack gap="md" h="calc(100vh - 88px)">
      <Title order={2}>{t("chat.title")}</Title>

      <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        <Paper
          withBorder
          radius="md"
          p="sm"
          className={mobileShowList ? "flex flex-col" : "hidden md:flex md:flex-col"}
          style={{ minHeight: 0 }}
        >
          <Button
            leftSection={<IconPlus size={16} />}
            variant="light"
            mb="sm"
            onClick={newChat}
          >
            {t("chat.newConversation")}
          </Button>
          <ScrollArea style={{ flex: 1 }}>
            <Stack gap={4}>
              {(conversations ?? []).map((c) => (
                <Group
                  key={c.id}
                  justify="space-between"
                  wrap="nowrap"
                  p="xs"
                  gap={4}
                  style={{
                    cursor: "pointer",
                    borderRadius: 6,
                    background:
                      activeId === c.id ? "var(--mantine-color-teal-light)" : undefined,
                  }}
                  onClick={() => openConversation(c.id)}
                >
                  <Stack gap={0} style={{ overflow: "hidden" }}>
                    <Text size="sm" fw={500} truncate>
                      {c.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {formatDateTime(c.updated_at)}
                    </Text>
                  </Stack>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(t, t("chat.deleteConfirm"), () => deleteMutation.mutate(c.id));
                    }}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
              {conversations && conversations.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" mt="md">
                  {t("chat.noConversations")}
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Paper>

        <Paper
          withBorder
          radius="md"
          p="md"
          className={mobileShowList ? "hidden md:flex md:flex-col" : "flex flex-col"}
          style={{ minHeight: 0 }}
        >
          <Group gap="xs" mb="xs" className="md:hidden">
            <ActionIcon variant="subtle" onClick={() => setMobileShowList(true)}>
              <IconArrowLeft size={18} />
            </ActionIcon>
            <Text size="sm" fw={500} truncate>
              {activeConversation?.title || t("chat.newConversation")}
            </Text>
          </Group>
          <ScrollArea style={{ flex: 1 }} viewportRef={viewportRef}>
            <Stack gap="sm">
              {messages.length === 0 && (
                <Text c="dimmed" ta="center" mt="xl">
                  {t("chat.empty")}
                </Text>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showReturnBadge =
                  prev && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > RETURN_GAP_MS;
                return (
                  <div key={m.id}>
                    {showReturnBadge && (
                      <Group justify="center" my="xs">
                        <Badge variant="light" color="gray" size="sm">
                          {formatDateTime(m.created_at)}
                        </Badge>
                      </Group>
                    )}
                    <Group
                      justify={m.role === "user" ? "flex-end" : "flex-start"}
                      align="flex-start"
                      wrap="nowrap"
                    >
                      <Stack gap={2} style={{ maxWidth: "85%" }} align={m.role === "user" ? "flex-end" : "flex-start"}>
                        <Paper
                          withBorder
                          radius="md"
                          p="sm"
                          bg={m.role === "user" ? "teal.6" : undefined}
                          c={m.role === "user" ? "white" : undefined}
                        >
                          {m.role === "assistant" ? (
                            <TypographyStylesProvider p={0} fz="sm">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {m.content}
                              </ReactMarkdown>
                            </TypographyStylesProvider>
                          ) : (
                            <Text style={{ whiteSpace: "pre-wrap" }}>{m.content}</Text>
                          )}
                        </Paper>
                        <Text size="xs" c="dimmed" px={4}>
                          {formatTime(m.created_at)}
                        </Text>
                      </Stack>
                    </Group>
                  </div>
                );
              })}
              {sendMutation.isPending && (
                <Group align="flex-start" wrap="nowrap">
                  <Loader size="sm" />
                </Group>
              )}
            </Stack>
          </ScrollArea>

          {sendMutation.isError && (
            <Alert color="red" mt="sm">
              {String(sendMutation.error)}
            </Alert>
          )}

          <Group mt="sm" align="flex-end" wrap="nowrap">
            <Textarea
              placeholder={t("chat.placeholder")}
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              autosize
              minRows={1}
              maxRows={4}
              style={{ flex: 1 }}
            />
            <ActionIcon
              size="xl"
              onClick={send}
              loading={sendMutation.isPending}
              disabled={!input.trim()}
            >
              <IconSend size={18} />
            </ActionIcon>
          </Group>
        </Paper>
      </div>
    </Stack>
  );
}
