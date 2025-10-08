import { useQuery } from "@tanstack/react-query";

interface PracticeHeaderProps {
  variant?: "invoice" | "full";
  align?: "left" | "right";
}

export function PracticeHeader({ variant = "full", align = "right" }: PracticeHeaderProps) {
  const { data: practiceSettings } = useQuery({
    queryKey: ['/api/system-options/categories/practice_settings'],
    queryFn: async () => {
      const categoriesResponse = await fetch("/api/system-options/categories");
      const categoriesData = await categoriesResponse.json();
      const practiceCategory = categoriesData.find((cat: any) => cat.categoryKey === 'practice_settings');
      
      if (!practiceCategory) {
        return { options: [] };
      }
      
      const response = await fetch(`/api/system-options/categories/${practiceCategory.id}`);
      return response.json();
    },
    staleTime: 1000 * 60 * 30,
  });

  const getSettingValue = (key: string) => {
    const option = practiceSettings?.options?.find((opt: any) => opt.optionKey === key);
    return option?.optionValue || option?.optionLabel || '';
  };

  const practiceName = getSettingValue('practice_name') || 'Therapy Practice';
  const practiceAddress = getSettingValue('practice_address');
  const practicePhone = getSettingValue('practice_phone');
  const practiceEmail = getSettingValue('practice_email');
  const practiceWebsite = getSettingValue('practice_website');

  const alignClass = align === "right" ? "text-right" : "text-left";

  if (variant === "invoice") {
    return (
      <div className={alignClass}>
        <h3 className="text-lg font-bold text-slate-900">{practiceName}</h3>
        <p className="text-sm text-slate-600">{practiceAddress}</p>
        <p className="text-sm text-slate-600">{practicePhone}</p>
        <p className="text-sm text-slate-600">{practiceEmail}</p>
      </div>
    );
  }

  return (
    <>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{practiceName}</h3>
      <div className="mt-2 text-sm text-slate-600">
        <p className="whitespace-pre-line">{practiceAddress}</p>
        <p>Phone: {practicePhone}</p>
        <p>Email: {practiceEmail}</p>
        <p>Website: {practiceWebsite}</p>
      </div>
    </>
  );
}
