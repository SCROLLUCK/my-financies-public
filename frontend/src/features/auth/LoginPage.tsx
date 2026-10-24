import { Button, Card, Center, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import type { MeResponse } from "../../api/types";

export function LoginPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const form = useForm({
    initialValues: { username: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: (values: typeof form.values) => api.post<MeResponse>("/auth/login/", values),
    onSuccess: (data) => {
      qc.setQueryData(["auth", "me"], data);
    },
    onError: () => {
      notifications.show({ message: t("auth.invalidCredentials"), color: "red" });
    },
  });

  return (
    <Center h="100vh">
      <Card withBorder padding="lg" radius="md" maw={360} w="100%">
        <Stack>
          <Title order={3}>{t("auth.title")}</Title>
          <form onSubmit={form.onSubmit((v) => loginMutation.mutate(v))}>
            <Stack>
              <TextInput
                label={t("auth.username")}
                autoFocus
                {...form.getInputProps("username")}
              />
              <PasswordInput label={t("auth.password")} {...form.getInputProps("password")} />
              <Button type="submit" loading={loginMutation.isPending} fullWidth>
                {t("auth.submit")}
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  );
}
