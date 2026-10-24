import { useEffect } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  Image,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api, API_URL } from "../../lib/api";
import type { GatewayChat, GatewayStatus, NotificationSettings } from "../../api/types";

const STATUS_COLORS: Record<GatewayStatus["state"], string> = {
  open: "teal",
  qr: "yellow",
  connecting: "gray",
  close: "red",
  unreachable: "red",
};

export function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["notification-settings"],
    queryFn: () => api.get<NotificationSettings>("/notifications/settings/"),
  });

  const { data: status, dataUpdatedAt: statusUpdatedAt } = useQuery({
    queryKey: ["gateway-status"],
    queryFn: () => api.get<GatewayStatus>("/notifications/gateway/status/"),
    refetchInterval: (query) => (query.state.data?.connected ? 10000 : 3000),
  });

  const { data: chats } = useQuery({
    queryKey: ["gateway-chats"],
    queryFn: () => api.get<GatewayChat[]>("/notifications/gateway/chats/"),
    refetchInterval: status?.connected ? 5000 : false,
  });

  const form = useForm({
    initialValues: {
      enabled: false,
      chat_id: "",
      lead_days: "7,3,1",
      notify_on_due_day: true,
    },
  });

  useEffect(() => {
    if (!settings) return;
    form.setValues({
      enabled: settings.enabled,
      chat_id: settings.chat_id,
      lead_days: settings.lead_days.join(","),
      notify_on_due_day: settings.notify_on_due_day,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const chat = (chats ?? []).find((c) => c.id === values.chat_id);
      return api.patch<NotificationSettings>("/notifications/settings/", {
        enabled: values.enabled,
        chat_id: values.chat_id,
        chat_name: chat?.name ?? settings?.chat_name ?? "",
        lead_days: values.lead_days
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n)),
        notify_on_due_day: values.notify_on_due_day,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      notifications.show({ message: t("settings.saved"), color: "teal" });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const testSendMutation = useMutation({
    mutationFn: () => api.post("/notifications/test-send/", {}),
    onSuccess: () => notifications.show({ message: t("settings.testSent"), color: "teal" }),
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const handleTestSend = async () => {
    if (!form.values.chat_id) {
      notifications.show({ message: t("settings.needChatFirst"), color: "red" });
      return;
    }
    // Save first so a picked-but-unsaved chat doesn't cause a confusing
    // "no chat set" error against the persisted value.
    await saveMutation.mutateAsync(form.values);
    testSendMutation.mutate();
  };

  // The gateway's chat directory is in-memory only and resets on restart, so
  // the already-saved choice can briefly disappear from the live list even
  // though it's still the correct selection — always keep it as an option.
  const chatOptions = (chats ?? []).map((c) => ({ value: c.id, label: c.name }));
  if (settings?.chat_id && !chatOptions.some((c) => c.value === settings.chat_id)) {
    chatOptions.push({ value: settings.chat_id, label: settings.chat_name });
  }

  return (
    <Stack gap="lg" maw={560}>
      <Title order={2}>{t("settings.title")}</Title>

      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={4}>{t("settings.linking")}</Title>
          {status && (
            <Badge color={STATUS_COLORS[status.state]} variant="light">
              {t(`settings.state_${status.state}`)}
            </Badge>
          )}
        </Group>

        {status?.state === "qr" && (
          <Stack align="center" gap="xs">
            <Image
              src={`${API_URL}/notifications/gateway/qr/?t=${statusUpdatedAt}`}
              w={220}
              h={220}
              fit="contain"
            />
            <Text size="sm" c="dimmed">
              {t("settings.scanHint")}
            </Text>
          </Stack>
        )}
        {status?.state === "open" && (
          <Text size="sm" c="dimmed">
            {t("settings.connectedHint")}
          </Text>
        )}
        {status?.state === "unreachable" && (
          <Text size="sm" c="red">
            {t("settings.unreachableHint")}
          </Text>
        )}
      </Card>

      <Card withBorder padding="lg" radius="md">
        <Title order={4} mb="md">
          {t("settings.reminders")}
        </Title>
        <form onSubmit={form.onSubmit((v) => saveMutation.mutate(v))}>
          <Stack>
            <Select
              label={t("settings.chat")}
              description={t("settings.chatHint")}
              placeholder={t("settings.pickChat")}
              searchable
              clearable
              data={chatOptions}
              {...form.getInputProps("chat_id")}
            />
            <Switch
              label={t("settings.enabled")}
              {...form.getInputProps("enabled", { type: "checkbox" })}
            />
            <TextInput
              label={t("settings.leadDays")}
              description={t("settings.leadDaysHint")}
              placeholder="7,3,1"
              {...form.getInputProps("lead_days")}
            />
            <Switch
              label={t("settings.notifyOnDueDay")}
              {...form.getInputProps("notify_on_due_day", { type: "checkbox" })}
            />
            <Group justify="space-between" mt="sm">
              <Button
                variant="light"
                onClick={handleTestSend}
                loading={testSendMutation.isPending || saveMutation.isPending}
              >
                {t("settings.sendTest")}
              </Button>
              <Button type="submit" loading={saveMutation.isPending}>
                {t("common.save")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
