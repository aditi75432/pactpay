import { redirect } from "next/navigation";

/** This used to be a separate page. It is now one step of the Shop workflow. */
export default function Moved() {
  redirect("/");
}
