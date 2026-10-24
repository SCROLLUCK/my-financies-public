import { useTranslation } from "react-i18next";

// Topic/Category names are stored in English in the DB (stable keys). We localize them
// for display so they follow the PT/EN switch. Unknown names (user-created) fall back
// to the raw name.
const PT: Record<string, string> = {
  // Topics
  Food: "Alimentação",
  Hygiene: "Higiene",
  Aesthetics: "Estética",
  Health: "Saúde",
  Mobility: "Mobilidade",
  Vehicle: "Veículo",
  "Leisure & entertainment": "Lazer e entretenimento",
  Housing: "Moradia",
  Subscriptions: "Assinaturas",
  Education: "Educação",
  Clothing: "Vestuário",
  Other: "Outros",
  // Categories
  Groceries: "Mercado",
  Restaurant: "Restaurante",
  "iFood/Delivery": "iFood/Delivery",
  Snacks: "Lanches",
  Toiletries: "Higiene pessoal",
  "Cleaning supplies": "Produtos de limpeza",
  Haircut: "Cabelo",
  Skincare: "Cuidados com a pele",
  Nails: "Unhas",
  Cosmetics: "Cosméticos",
  Pharmacy: "Farmácia",
  Doctor: "Médico",
  Dental: "Dentista",
  Gym: "Academia",
  "Life insurance": "Seguro de vida",
  "Health plan": "Plano de saúde",
  Fuel: "Combustível",
  Maintenance: "Manutenção",
  Insurance: "Seguro",
  Parking: "Estacionamento",
  Tolls: "Pedágio",
  "Ride-hailing/Transit": "Uber/Transporte",
  Streaming: "Streaming",
  Bars: "Bares",
  Travel: "Viagem",
  Games: "Jogos",
  Events: "Eventos",
  Rent: "Aluguel",
  Condo: "Condomínio",
  Utilities: "Contas (água/luz/gás)",
  Internet: "Internet",
  Furniture: "Móveis",
  Software: "Software",
  Memberships: "Mensalidades",
  College: "Faculdade",
  Courses: "Cursos",
  Books: "Livros",
  "School supplies": "Material escolar",
  Clothes: "Roupas",
  Accessories: "Acessórios",
  Laundry: "Lavanderia",
  "Credit card bill": "Fatura do cartão",
  "Department store": "Loja de departamento",
  "Taxes & fees": "Impostos e taxas",
  Transfers: "Transferências",
  Uncategorized: "Sem categoria",
};

/** Returns a function that localizes a topic/category name for the current language. */
export function useTaxonomyLabel(): (name: string) => string {
  const { i18n } = useTranslation();
  const isPt = i18n.language.startsWith("pt");
  return (name: string) => (isPt ? PT[name] ?? name : name);
}
