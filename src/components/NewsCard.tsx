import { CATEGORIES } from "@/lib/categories";
import { formatRelative, hostOf, stripHtml } from "@/lib/format";
import { Thumbnail } from "@/components/Thumbnail";
import { PrintLink } from "@/components/PrintLink";

const labelOf = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

export type NewsCardItem = {
  link: string;
  originallink: string;
  title: string;
  pubDate: string;
  description?: string;
  categories?: string[];
  imageUrl?: string | null;
};

export function NewsCard({ item }: { item: NewsCardItem }) {
  const categories = item.categories ?? [];
  const placeholderLabel = categories[0] ? labelOf(categories[0]) : "KBCI";
  const summary = item.description ? stripHtml(item.description) : "";

  return (
    <article className="group flex items-start gap-4 py-5 sm:gap-6 sm:py-7">
      <div className="min-w-0 flex-1">
        {categories.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-x-1.5 text-[12px] font-bold tracking-wider text-[#9A7A12]">
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
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <h3 className="text-[19px] font-bold leading-snug tracking-tight text-gray-900 decoration-[#FFB81C] decoration-2 underline-offset-2 group-hover:underline sm:text-[21px]">
            {stripHtml(item.title)}
          </h3>
          {summary && (
            <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-gray-600 sm:text-[15px]">
              {summary}
            </p>
          )}
        </a>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-500">
          <span>
            <span className="font-medium text-gray-700">
              {hostOf(item.originallink)}
            </span>
            <span className="mx-1.5">—</span>
            <span>{formatRelative(item.pubDate)}</span>
          </span>
          <PrintLink links={[item.link]} />
        </div>
      </div>

      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="block shrink-0"
        tabIndex={-1}
        aria-hidden
      >
        <Thumbnail
          src={item.imageUrl}
          label={placeholderLabel}
          className="h-[72px] w-[104px] rounded-lg sm:h-[108px] sm:w-[168px]"
        />
      </a>
    </article>
  );
}
