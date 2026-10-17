import type {ActionAvailability} from "./profile-console.js";
export interface RepositoryRefs {
  refs:Array<{name:string;commit:string;kind:"branch"|"tag"|"remote"}>;
  offset:number;limit:number;nextOffset?:number;truncated?:boolean;
}
export interface RepositoryConsoleContext {
  repositoryId:string;projectId:string;runnerId:string;runnerBindingSource:"explicit"|"legacy-local";configRevision:number;
  git:{state:"valid"|"invalid"|"unavailable";baseRef:string;baseCommit?:string;reasonCode?:string};
  scopePaths:string[];verificationCommands:Array<{id:string;required:boolean}>;
  actions:Record<"publish"|"refs",ActionAvailability>;
}
export interface DirectorySelection {
  id:string;runnerId:string;purpose:"repository";state:"pending"|"cancelling"|"selected"|"cancelled"|"unavailable";
  createdAt:string;path?:string;reasonCode?:string;
}
