export interface Topic {
  id: number;
  name: string;
  slug: string;
  is_food: boolean;
  color: string;
  icon: string;
  order: number;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  aliases: string[];
  color: string;
  icon: string;
  topic: Topic;
  expense_count: number;
}

export interface CategoryLite {
  id: number;
  name: string;
  slug: string;
  color: string;
  topic: Topic;
}

export interface Merchant {
  id: number;
  name: string;
  kind: string;
  cnpj: string;
}

export interface Expense {
  id: number;
  amount: string;
  occurred_at: string;
  description: string;
  kind: string;
  source: string;
  spent_by: "owner" | "partner" | "";
  category: CategoryLite;
  merchant: Merchant | null;
  created_at: string;
}

export interface RecurringExpense {
  id: number;
  name: string;
  type: "fixed" | "subscription" | "installment";
  amount: string;
  cadence: "monthly" | "yearly";
  due_day: number;
  category: CategoryLite;
  merchant: Merchant | null;
  active: boolean;
  start_date: string;
  end_date: string | null;
  installments: number | null;
}

export interface Bill {
  id: number;
  name: string;
  amount: string;
  due_date: string;
  status: "pending" | "paid";
  paid_at: string | null;
  recurring: number | null;
  category: CategoryLite;
  expense: number | null;
  is_overdue: boolean;
}

export interface IncomeSource {
  id: number;
  name: string;
  amount: string;
  end_date: string | null;
  is_active: boolean;
}

export interface Product {
  id: number;
  name: string;
  unit: string;
  category: CategoryLite | null;
  cheapest_price: string | null;
  last_price_date: string | null;
}

export interface PriceObservation {
  id: number;
  product: { id: number; name: string; unit: string };
  merchant: Merchant;
  price: string;
  date: string;
  source: string;
}

export interface ShoppingList {
  id: number;
  name: string;
  store: Merchant | null;
  status: "active" | "completed" | "archived";
  created_at: string;
  completed_at: string | null;
  items_total: number;
  items_checked: number;
}

export interface ShoppingListItem {
  id: number;
  product: { id: number; name: string; unit: string } | null;
  name: string;
  quantity: string;
  unit: string;
  checked: boolean;
  checked_at: string | null;
  paid_price: string | null;
  note: string;
  order: number;
  cheapest: {
    merchant_id: number;
    merchant_name: string;
    price: string;
    date: string;
  } | null;
}

export interface ProductPriceSummary {
  product: Product;
  by_store: {
    merchant: Merchant;
    latest_price: string;
    latest_date: string;
    lowest_price: string;
  }[];
  cheapest: {
    merchant_id: number;
    merchant_name: string;
    price: string;
    date: string;
  } | null;
}

export interface FoodSummary {
  month: string;
  total: number;
  by_category: {
    category_id: number;
    name: string;
    slug: string;
    color: string;
    total: number;
  }[];
  trend: {
    month: string;
    total: number;
    by_category: { category_id: number; name: string; total: number }[];
  }[];
}

export interface ReceiptLineItem {
  description: string;
  quantity: string | null;
  unit_price: string | null;
  total_price: string | null;
}

export interface Receipt {
  id: number;
  image: string;
  uploaded_at: string;
  channel: string;
  status:
    | "uploaded"
    | "parsed"
    | "awaiting_confirmation"
    | "confirmed"
    | "cancelled"
    | "failed";
  merchant_guess: string;
  cnpj_guess: string;
  date_guess: string | null;
  total_guess: string | null;
  line_items: ReceiptLineItem[];
  suggested_category: CategoryLite | null;
  ocr_text: string;
  expense: number | null;
}

export interface PossibleDuplicateExpense {
  id: number;
  description: string;
  occurred_at: string;
  source: string;
}

export interface StatementTransaction {
  id: number;
  date: string;
  amount: string;
  direction: "in" | "out";
  name: string;
  memo: string;
  status: "pending" | "imported" | "skipped";
  suggested_category: CategoryLite | null;
  expense: number | null;
  income: number | null;
  possible_duplicate: PossibleDuplicateExpense | null;
}

export interface Income {
  id: number;
  amount: string;
  occurred_at: string;
  description: string;
  source: string;
  created_at: string;
}

export interface StatementImport {
  id: number;
  original_name: string;
  format: "ofx" | "csv";
  bank: string;
  uploaded_at: string;
  transactions_found: number;
  duplicates_skipped: number;
  pending_count?: number;
  transactions?: StatementTransaction[];
}

export interface PlannedPurchase {
  id: number;
  name: string;
  estimated_cost: string | null;
  priority: "low" | "medium" | "high";
  category: CategoryLite | null;
  target_date: string | null;
  notes: string;
  url: string;
  status: "planned" | "purchased" | "dropped";
  expense: number | null;
  created_at: string;
  purchased_at: string | null;
}

export interface ProjectedExpense {
  name: string;
  amount: string;
  due_date: string;
  kind: string;
  category: CategoryLite;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  conversation_id: number;
  title: string;
}

export interface NotificationSettings {
  enabled: boolean;
  chat_id: string;
  chat_name: string;
  lead_days: number[];
  notify_on_due_day: boolean;
}

export interface GatewayStatus {
  state: "qr" | "connecting" | "open" | "close" | "unreachable";
  connected: boolean;
}

export interface GatewayChat {
  id: string;
  name: string;
}

export interface Dashboard {
  month: string;
  total_so_far: number;
  prev_month_total: number;
  by_topic: { topic_id: number; name: string; color: string; total: number }[];
  by_category: {
    topic_id: number;
    topic_name: string;
    category_id: number;
    category_name: string;
    total: number;
  }[];
  by_day: { date: string; total: number; cumulative: number }[];
  upcoming_bills: Bill[];
}

export interface MeResponse {
  authenticated: boolean;
  username?: string;
}
