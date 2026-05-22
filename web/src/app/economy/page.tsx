import { PageHeader } from "@/components/page-header";
import { EconomyLab } from "@/components/economy-lab";

export default function EconomyPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Economy Lab"
        description="Run summon simulations without launching the bot. Use this to tune popularity weighting, pity behavior, and mystery token rates."
      />
      <EconomyLab />
    </div>
  );
}
