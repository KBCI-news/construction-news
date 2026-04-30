import { CATEGORIES, getCategory } from "@/lib/categories";
import CategoryPageClient from "@/components/CategoryPageClient";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ id: c.id }));
}

export function generateMetadata({ params }: { params: { id: string } }) {
  const category = getCategory(params.id);
  return {
    title: category ? `${category.label} - KBCI 뉴스` : "KBCI 뉴스",
  };
}

export default function CategoryPage({
  params,
}: {
  params: { id: string };
}) {
  const category = getCategory(params.id);
  if (!category) notFound();
  return (
    <CategoryPageClient
      categoryId={params.id}
      categoryLabel={category.label}
    />
  );
}
