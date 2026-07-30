"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

/**
 * Searchable language picker.
 *
 * A plain `<select>` with 34 options is workable but slow to use; typing "ts" to reach TypeScript is
 * what people expect from an editor. Formattable languages are grouped first because that grouping
 * is the one thing a user cannot discover by looking at a flat list.
 */
export function LanguageSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  /** Associates the trigger with its <Label>, which is what gives the combobox an accessible name. */
  id: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(
    () => ({
      formattable: LANGUAGES.filter((language) => language.formatter !== null),
      other: LANGUAGES.filter((language) => language.formatter === null),
    }),
    [],
  );

  const selected = LANGUAGES.find((language) => language.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {selected?.label ?? "Select a format"}
            <ChevronsUpDown className="opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search formats…" />
          <CommandList>
            <CommandEmpty>No matching format.</CommandEmpty>
            <CommandGroup heading="Can be formatted">
              {groups.formattable.map((language) => (
                <LanguageItem
                  key={language.id}
                  id={language.id}
                  label={language.label}
                  selected={language.id === value}
                  onSelect={(id) => {
                    onChange(id);
                    setOpen(false);
                  }}
                />
              ))}
            </CommandGroup>
            <CommandGroup heading="Highlight only">
              {groups.other.map((language) => (
                <LanguageItem
                  key={language.id}
                  id={language.id}
                  label={language.label}
                  selected={language.id === value}
                  onSelect={(id) => {
                    onChange(id);
                    setOpen(false);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LanguageItem({
  id,
  label,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    // The value is the label so typing matches what the user sees, not the internal id.
    <CommandItem value={label} onSelect={() => onSelect(id)}>
      {label}
      <Check className={cn("ml-auto", selected ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );
}
