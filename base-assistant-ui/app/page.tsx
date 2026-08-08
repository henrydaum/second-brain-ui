import { DemoRuntimeProvider } from "@/components/runtime/demo-runtime-provider";
import { Base } from "@/components/examples/base";
import { BaseConfigProvider } from "@/lib/base/config-provider";
import { defaultBaseConfig } from "@/lib/base/defaults";

export default function Page() {
  return (
    <main className="h-dvh overflow-hidden">
      <BaseConfigProvider value={defaultBaseConfig}>
        <DemoRuntimeProvider>
          <Base />
        </DemoRuntimeProvider>
      </BaseConfigProvider>
    </main>
  );
}
