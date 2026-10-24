import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  ColorInput,
  ColorSwatch,
  Group,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { useTaxonomyLabel } from "../../i18n/taxonomy";
import type { Category, Topic } from "../../api/types";

export function CategoriesPage() {
  const { t } = useTranslation();
  const tx = useTaxonomyLabel();
  const [opened, { open, close }] = useDisclosure(false);
  const [topicOpened, topicModal] = useDisclosure(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const qc = useQueryClient();

  const { data: topics } = useQuery({
    queryKey: ["topics"],
    queryFn: () => api.get<Topic[]>("/topics/"),
  });
  const { data: categories, isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories/"),
  });

  const form = useForm({
    initialValues: { name: "", topic_id: "", aliases: [] as string[] },
    validate: {
      name: (v) => (v.trim() ? null : t("categories.errName")),
      topic_id: (v) => (v ? null : t("categories.errTopic")),
    },
  });

  const topicForm = useForm({
    initialValues: { name: "", color: "#868e96", is_food: false },
    validate: { name: (v) => (v.trim() ? null : t("categories.errName")) },
  });

  const createTopicMutation = useMutation({
    mutationFn: (values: typeof topicForm.values) =>
      api.post<Topic>("/topics/", {
        name: values.name,
        color: values.color,
        is_food: values.is_food,
        order: (topics ?? []).length,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["topics"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      notifications.show({ message: t("categories.topicAdded"), color: "teal" });
      topicForm.reset();
      topicModal.close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset();
    open();
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    form.setValues({
      name: c.name,
      topic_id: String(c.topic.id),
      aliases: c.aliases ?? [],
    });
    open();
  };

  const saveMutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const payload = {
        name: values.name,
        topic_id: Number(values.topic_id),
        aliases: values.aliases,
      };
      return editing
        ? api.patch<Category>(`/categories/${editing.id}/`, payload)
        : api.post<Category>("/categories/", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      // Renames/moves change names embedded in cached expense rows and charts.
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["food"] });
      notifications.show({
        message: t(editing ? "categories.updated" : "categories.added"),
        color: "teal",
      });
      form.reset();
      close();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  if (isLoading || !topics || !categories) return <Loader />;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>{t("categories.title")}</Title>
        <Group>
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={topicModal.open}
          >
            {t("categories.addTopic")}
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            {t("categories.add")}
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {topics.map((topic) => {
          const leaves = categories.filter((c) => c.topic.id === topic.id);
          const topicCount = leaves.reduce((sum, c) => sum + c.expense_count, 0);
          return (
            <Card key={topic.id} withBorder padding="md" radius="md">
              <Group mb="sm" gap="xs" justify="space-between">
                <Group gap="xs">
                  <ColorSwatch color={topic.color || "#868e96"} size={16} />
                  <Text fw={600}>{tx(topic.name)}</Text>
                  {topic.is_food && (
                    <Badge size="xs" color="yellow">
                      {t("common.food")}
                    </Badge>
                  )}
                </Group>
                <Badge variant="light" color="teal">
                  {topicCount}
                </Badge>
              </Group>
              <Group gap="xs">
                {leaves.map((c) => (
                  <Badge
                    key={c.id}
                    variant="light"
                    color="gray"
                    style={{ cursor: "pointer", textTransform: "none" }}
                    onClick={() => openEdit(c)}
                    rightSection={
                      <Text span size="xs" c="dimmed">
                        {c.expense_count}
                      </Text>
                    }
                  >
                    {tx(c.name)}
                  </Badge>
                ))}
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>

      <Modal
        opened={opened}
        onClose={close}
        title={t(editing ? "categories.edit" : "categories.add")}
      >
        <form onSubmit={form.onSubmit((v) => saveMutation.mutate(v))}>
          <Stack>
            <TextInput label={t("categories.name")} {...form.getInputProps("name")} />
            <Select
              label={t("categories.topic")}
              searchable
              data={topics.map((t2) => ({ value: String(t2.id), label: tx(t2.name) }))}
              {...form.getInputProps("topic_id")}
            />
            <TagsInput
              label={t("categories.aliases")}
              description={t("categories.aliasesHint")}
              {...form.getInputProps("aliases")}
            />
            <Button type="submit" loading={saveMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={topicOpened}
        onClose={topicModal.close}
        title={t("categories.addTopic")}
      >
        <form onSubmit={topicForm.onSubmit((v) => createTopicMutation.mutate(v))}>
          <Stack>
            <TextInput
              label={t("categories.name")}
              {...topicForm.getInputProps("name")}
            />
            <ColorInput
              label={t("categories.color")}
              {...topicForm.getInputProps("color")}
            />
            <Switch
              label={t("categories.isFood")}
              {...topicForm.getInputProps("is_food", { type: "checkbox" })}
            />
            <Button type="submit" loading={createTopicMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
