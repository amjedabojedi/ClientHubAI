import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select";

interface SystemOption {
  id: number;
  optionKey: string;
  optionLabel: string;
  sortOrder: number;
}

interface Props {
  value: string | null | undefined;
  onChange: (value: string) => void;
}

const NONE_LABEL = "None / Self-Pay";
const OTHER_LABEL = "Other (specify)";

export function InsuranceProviderField({ value, onChange }: Props) {
  const { data: options = [], isLoading } = useQuery<SystemOption[]>({
    queryKey: ["/api/system-options/by-category/insurance_providers"],
  });

  const labels = useMemo(() => options.map((o) => o.optionLabel), [options]);

  const trimmed = (value ?? "").trim();
  const valueIsKnown = trimmed === "" || labels.includes(trimmed);
  const valueIsLegacyCustom = trimmed !== "" && !valueIsKnown && labels.length > 0;

  const [otherMode, setOtherMode] = useState<boolean>(valueIsLegacyCustom);
  const [otherText, setOtherText] = useState<string>(valueIsLegacyCustom ? trimmed : "");

  useEffect(() => {
    if (labels.length === 0) return;
    if (trimmed !== "" && !labels.includes(trimmed)) {
      setOtherMode(true);
      setOtherText(trimmed);
    }
  }, [trimmed, labels]);

  const selectOptions: SearchableSelectOption[] = useMemo(() => {
    return options.map((o) => ({ value: o.optionLabel, label: o.optionLabel }));
  }, [options]);

  const selectValue = otherMode ? OTHER_LABEL : trimmed === "" ? NONE_LABEL : trimmed;

  const handleSelect = (next: string) => {
    if (next === OTHER_LABEL) {
      setOtherMode(true);
      onChange(otherText.trim());
      return;
    }
    setOtherMode(false);
    if (next === NONE_LABEL) {
      onChange("");
    } else {
      onChange(next);
    }
  };

  const handleOtherText = (text: string) => {
    setOtherText(text);
    onChange(text.trim());
  };

  return (
    <div className="space-y-2">
      <SearchableSelect
        value={selectValue}
        onValueChange={handleSelect}
        options={selectOptions}
        placeholder={isLoading ? "Loading providers..." : "Select insurance provider"}
        searchPlaceholder="Search providers..."
      />
      {otherMode && (
        <Input
          value={otherText}
          onChange={(e) => handleOtherText(e.target.value)}
          placeholder="Enter insurance provider name"
          data-testid="input-insurance-provider-other"
        />
      )}
    </div>
  );
}
