import { redirect } from "next/navigation";

export default function FeaturedRedirect() {
  redirect("/?minScore=72");
}
