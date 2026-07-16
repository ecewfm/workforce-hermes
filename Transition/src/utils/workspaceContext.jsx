import { createContext, useContext } from "react";
import { DEFAULT_WORKSPACE } from "./departments";

/**
 * Carries the ACTIVE workspace ("executives" | "operations" | "workforce")
 * down the authenticated tree. Components that run workspace-scoped Convex
 * queries/mutations read it via useWorkspace() and pass it as the `workspace`
 * arg. Using a context (rather than prop-drilling through ~13 components) keeps
 * the queries reactive: switching workspace re-renders consumers, which re-fires
 * their useQuery calls with the new key.
 *
 * Defaults to "workforce" so any component accidentally rendered outside the
 * provider still behaves exactly as before the feature (all legacy data is WFM).
 */
export const WorkspaceContext = createContext(DEFAULT_WORKSPACE);

export function useWorkspace() {
  return useContext(WorkspaceContext) || DEFAULT_WORKSPACE;
}
