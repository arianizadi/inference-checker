import { getConfig, getAllScenes } from "../lib/data";
import Viewer from "../components/Viewer";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = getConfig();
  const allScenes = getAllScenes();

  // Only pass lightweight metadata — no PNG reading, no stats computation
  const scenes = allScenes.map((scene) => ({
    id: scene.id,
    inputImage: scene.inputImage,
    groundTruth: scene.groundTruth,
    models: scene.models.map((m) => ({
      name: m.name,
      filename: m.filename,
    })),
  }));

  return (
    <main className="min-h-screen">
      <Viewer scenes={scenes} config={config} />
    </main>
  );
}
