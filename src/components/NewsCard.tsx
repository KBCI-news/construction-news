import { CATEGORIES } from "@/lib/categories";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

export type NewsCardItem = {
  link: string;
  originallink: string;
  title: string;
  pubDate: string;
  categories?: string[];
};

export function NewsCard({ item }: { item: NewsCardItem }) {
  const categories = item.categories ?? [];
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group block py-5 transition-colors hover:bg-gray-50/40 sm:py-6"
    >
      {categories.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 text-[11px] font-bold tracking-wider text-[#FFB81C]">
          {categories.map((id, i) => (
            <span key={id} className="flex items-center gap-1.5">
              <span>{labelOf(id)}</span>
              {i < categories.length - 1 && (
                <span className="text-gray-300">·</span>
              )}
            </span>
          ))}
        </div>
      )}
      <h3 className="text-[18px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[19px]">
        {stripHtml(item.title)}
      </h3>
      <p className="mt-2 text-[12px] text-gray-500">
        <span className="font-medium text-gray-700">
          {hostOf(item.originallink)}
        </span>
        <span className="mx-1.5">—</span>
        <span>{formatRelative(item.pubDate)}</span>
      </p>
    </a>
  );
}
