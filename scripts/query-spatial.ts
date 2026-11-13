/** Offline entry point for inspecting what the model can actually retrieve. */
import { pilotToolDeclarations, runPilotTool } from '../server/pilot-tools';

const [name, json] = process.argv.slice(2);
try {
  if (!name || name === '--help') {
    console.log(
      "npm run spatial:query -- <tool> '<JSON arguments>'\n" +
        pilotToolDeclarations.map((tool) => tool.name).join('\n'),
    );
  } else {
    console.log(JSON.stringify(runPilotTool(name, JSON.parse(json ?? '{}')), null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid spatial query');
  process.exitCode = 1;
}
