import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArchive,
  IconCheck,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { confirmDelete } from "../../lib/confirmDelete";
import { formatBRL } from "../../lib/format";
import type {
  Merchant,
  Product,
  ShoppingList,
  ShoppingListItem,
} from "../../api/types";

export function ShoppingPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [listId, setListId] = useState<string | null>(null);
  const [itemToCheck, setItemToCheck] = useState<ShoppingListItem | null>(null);
  const [paidPrice, setPaidPrice] = useState<string | number>("");
  const [newListOpened, newListModal] = useDisclosure(false);
  const [editingList, setEditingList] = useState<ShoppingList | null>(null);
  const qc = useQueryClient();

  const { data: lists, isLoading } = useQuery({
    queryKey: ["shopping-lists", statusFilter],
    queryFn: () =>
      api.get<ShoppingList[]>(`/shopping-lists/?status=${statusFilter}`),
  });

  const selectedList =
    (lists ?? []).find((l) => String(l.id) === listId) ?? (lists ?? [])[0] ?? null;

  const { data: items } = useQuery({
    queryKey: ["shopping-list-items", selectedList?.id],
    queryFn: () =>
      api.get<ShoppingListItem[]>(`/shopping-list-items/?list=${selectedList!.id}`),
    enabled: !!selectedList,
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get<Product[]>("/products/"),
  });

  const { data: merchants } = useQuery({
    queryKey: ["merchants"],
    queryFn: () => api.get<Merchant[]>("/merchants/"),
  });

  const listForm = useForm({
    initialValues: { name: "", store_id: "" as string },
    validate: { name: (v) => (v.trim() ? null : t("shopping.errListName")) },
  });

  const itemForm = useForm({
    initialValues: {
      product_id: "" as string,
      name: "",
      quantity: 1 as string | number,
    },
    validate: {
      name: (v, values) =>
        values.product_id || v.trim() ? null : t("shopping.errItem"),
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shopping-lists"] });
    qc.invalidateQueries({ queryKey: ["shopping-list-items"] });
  };

  const openCreateList = () => {
    setEditingList(null);
    listForm.reset();
    newListModal.open();
  };

  const openEditList = (l: ShoppingList) => {
    setEditingList(l);
    listForm.setValues({
      name: l.name,
      store_id: l.store ? String(l.store.id) : "",
    });
    newListModal.open();
  };

  const saveListMutation = useMutation({
    mutationFn: (values: typeof listForm.values) => {
      const payload = {
        name: values.name,
        store_id: values.store_id ? Number(values.store_id) : null,
      };
      return editingList
        ? api.patch<ShoppingList>(`/shopping-lists/${editingList.id}/`, payload)
        : api.post<ShoppingList>("/shopping-lists/", payload);
    },
    onSuccess: (saved) => {
      invalidate();
      notifications.show({
        message: t(editingList ? "shopping.listUpdated" : "shopping.listCreated"),
        color: "teal",
      });
      listForm.reset();
      newListModal.close();
      if (!editingList) {
        setStatusFilter("active");
        setListId(String(saved.id));
      }
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const addItemMutation = useMutation({
    mutationFn: (values: typeof itemForm.values) =>
      api.post<ShoppingListItem>("/shopping-list-items/", {
        list_id: selectedList!.id,
        product_id: values.product_id ? Number(values.product_id) : null,
        name: values.name,
        quantity: String(values.quantity || 1),
      }),
    onSuccess: () => {
      invalidate();
      itemForm.reset();
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const checkMutation = useMutation({
    mutationFn: ({ id, price }: { id: number; price?: string }) =>
      api.post<ShoppingListItem>(
        `/shopping-list-items/${id}/check/`,
        price ? { paid_price: price } : {}
      ),
    onSuccess: (_item, { price }) => {
      invalidate();
      if (price) {
        qc.invalidateQueries({ queryKey: ["price-observations"] });
        qc.invalidateQueries({ queryKey: ["product-summary"] });
      }
      setItemToCheck(null);
      setPaidPrice("");
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const uncheckMutation = useMutation({
    mutationFn: (id: number) =>
      api.post<ShoppingListItem>(`/shopping-list-items/${id}/uncheck/`, {}),
    onSuccess: invalidate,
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: number) => api.del(`/shopping-list-items/${id}/`),
    onSuccess: invalidate,
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) =>
      api.post<ShoppingList>(`/shopping-lists/${id}/complete/`, {}),
    onSuccess: () => {
      invalidate();
      notifications.show({ message: t("shopping.completedMsg"), color: "teal" });
    },
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const setListStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch<ShoppingList>(`/shopping-lists/${id}/`, { status }),
    onSuccess: invalidate,
    onError: (e) => notifications.show({ message: String(e), color: "red" }),
  });

  const listOptions = (lists ?? []).map((l) => ({
    value: String(l.id),
    label: l.name,
  }));

  const productOptions = (products ?? []).map((p) => ({
    value: String(p.id),
    label: p.unit ? `${p.name} (${p.unit})` : p.name,
  }));

  const merchantOptions = (merchants ?? []).map((m) => ({
    value: String(m.id),
    label: m.name,
  }));

  const unchecked = (items ?? []).filter((i) => !i.checked);
  const checked = (items ?? []).filter((i) => i.checked);

  const itemLabel = (item: ShoppingListItem) => {
    const qty = Number(item.quantity);
    const qtyStr = qty !== 1 ? `${qty}${item.unit ? ` ${item.unit}` : "x"} ` : "";
    return `${qtyStr}${item.name}`;
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>{t("shopping.title")}</Title>
        <Group>
          <Select
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v ?? "active");
              setListId(null);
            }}
            data={[
              { value: "active", label: t("shopping.active") },
              { value: "completed", label: t("shopping.completed") },
              { value: "archived", label: t("shopping.archived") },
            ]}
            maw={150}
          />
          <Select
            placeholder={t("shopping.selectList")}
            data={listOptions}
            value={selectedList ? String(selectedList.id) : null}
            onChange={setListId}
            maw={220}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={openCreateList}>
            {t("shopping.newList")}
          </Button>
        </Group>
      </Group>

      {isLoading ? (
        <Loader />
      ) : !selectedList ? (
        <Text c="dimmed">{t("shopping.noLists")}</Text>
      ) : (
        <Card withBorder padding="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Group gap="sm">
              <Title order={4}>{selectedList.name}</Title>
              <ActionIcon variant="subtle" onClick={() => openEditList(selectedList)}>
                <IconPencil size={16} />
              </ActionIcon>
              {selectedList.store && (
                <Badge variant="light" color="gray">
                  {selectedList.store.name}
                </Badge>
              )}
              <Badge variant="light" color="teal">
                {selectedList.items_checked}/{selectedList.items_total}{" "}
                {t("shopping.done")}
              </Badge>
            </Group>
            <Group gap="xs">
              {selectedList.status === "active" && (
                <>
                  <Button
                    size="compact-sm"
                    variant="light"
                    leftSection={<IconCheck size={14} />}
                    onClick={() => completeMutation.mutate(selectedList.id)}
                  >
                    {t("shopping.complete")}
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconArchive size={14} />}
                    onClick={() =>
                      setListStatusMutation.mutate({
                        id: selectedList.id,
                        status: "archived",
                      })
                    }
                  >
                    {t("shopping.archive")}
                  </Button>
                </>
              )}
              {selectedList.status !== "active" && (
                <Button
                  size="compact-sm"
                  variant="light"
                  onClick={() =>
                    setListStatusMutation.mutate({
                      id: selectedList.id,
                      status: "active",
                    })
                  }
                >
                  {t("shopping.reactivate")}
                </Button>
              )}
            </Group>
          </Group>

          {selectedList.status === "active" && (
            <form onSubmit={itemForm.onSubmit((v) => addItemMutation.mutate(v))}>
              <Group align="flex-end" mb="md" wrap="wrap">
                <Select
                  label={t("shopping.product")}
                  searchable
                  clearable
                  data={productOptions}
                  maw={200}
                  {...itemForm.getInputProps("product_id")}
                />
                <TextInput
                  label={t("shopping.itemName")}
                  maw={200}
                  {...itemForm.getInputProps("name")}
                />
                <NumberInput
                  label={t("shopping.quantity")}
                  min={0}
                  maw={90}
                  {...itemForm.getInputProps("quantity")}
                />
                <Button type="submit" loading={addItemMutation.isPending}>
                  {t("shopping.addItem")}
                </Button>
              </Group>
            </form>
          )}

          {!items?.length ? (
            <Text c="dimmed">{t("shopping.noItems")}</Text>
          ) : (
            <Stack gap="xs">
              {unchecked.map((item) => (
                <Group key={item.id} justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <Checkbox
                      checked={false}
                      onChange={() => setItemToCheck(item)}
                      disabled={selectedList.status !== "active"}
                    />
                    <div>
                      <Text>{itemLabel(item)}</Text>
                      {item.cheapest && (
                        <Text size="xs" c="dimmed">
                          {t("shopping.cheapestHint", {
                            price: formatBRL(item.cheapest.price),
                            store: item.cheapest.merchant_name,
                          })}
                        </Text>
                      )}
                    </div>
                  </Group>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() =>
                      confirmDelete(t, t("common.deleteItemConfirm", { name: itemLabel(item) }), () =>
                        deleteItemMutation.mutate(item.id)
                      )
                    }
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
              {checked.map((item) => (
                <Group key={item.id} justify="space-between" wrap="nowrap" opacity={0.5}>
                  <Group gap="sm" wrap="nowrap">
                    <Checkbox
                      checked
                      onChange={() => uncheckMutation.mutate(item.id)}
                      disabled={selectedList.status !== "active"}
                    />
                    <Text td="line-through">
                      {itemLabel(item)}
                      {item.paid_price ? ` — ${formatBRL(item.paid_price)}` : ""}
                    </Text>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Card>
      )}

      <Modal
        opened={newListOpened}
        onClose={newListModal.close}
        title={t(editingList ? "shopping.editList" : "shopping.newList")}
      >
        <form onSubmit={listForm.onSubmit((v) => saveListMutation.mutate(v))}>
          <Stack>
            <TextInput
              label={t("shopping.listName")}
              {...listForm.getInputProps("name")}
            />
            <Select
              label={t("shopping.storeOptional")}
              searchable
              clearable
              data={merchantOptions}
              {...listForm.getInputProps("store_id")}
            />
            <Button type="submit" loading={saveListMutation.isPending}>
              {t("common.save")}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={!!itemToCheck}
        onClose={() => setItemToCheck(null)}
        title={itemToCheck ? itemToCheck.name : ""}
      >
        <Stack>
          <NumberInput
            label={t("shopping.paidPrice")}
            description={
              itemToCheck?.product && !selectedList?.store
                ? t("shopping.noStoreHint")
                : undefined
            }
            decimalScale={2}
            fixedDecimalScale
            min={0}
            value={paidPrice}
            onChange={setPaidPrice}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() =>
                itemToCheck && checkMutation.mutate({ id: itemToCheck.id })
              }
            >
              {t("shopping.skipPrice")}
            </Button>
            <Button
              disabled={!Number(paidPrice)}
              loading={checkMutation.isPending}
              onClick={() =>
                itemToCheck &&
                checkMutation.mutate({
                  id: itemToCheck.id,
                  price: String(paidPrice),
                })
              }
            >
              {t("shopping.confirmPrice")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
