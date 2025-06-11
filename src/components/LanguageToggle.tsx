
"use client";

import * as React from "react";
import { Globe } from "lucide-react";
// import { useLocale } from "next-intl"; // Will be used later for i18n
// import { useRouter, usePathname } from "next/navigation"; // Will be used later for i18n

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LanguageToggle() {
  // const locale = useLocale(); // Will be used later
  // const router = useRouter(); // Will be used later
  // const pathname = usePathname(); // Will be used later

  // const changeLocale = (newLocale: string) => {
  //   // Placeholder for actual locale change logic
  //   console.log(`Changing locale to ${newLocale} for path ${pathname}`);
  //   // router.replace(`/${newLocale}${pathname.startsWith('/') ? '' : '/'}${pathname.substring(pathname.indexOf('/', 1))}`);
  // };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Globe className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Toggle language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => console.log("Selected KR")}>
          KR (한국어)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => console.log("Selected JP")}>
          JP (日本語)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
