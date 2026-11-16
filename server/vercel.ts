/** Vercel invokes this Express handler with the original visitor API or plan-image URL. */
import { configuredApplication } from './configured-app';
export default configuredApplication(process.env, true).app;
