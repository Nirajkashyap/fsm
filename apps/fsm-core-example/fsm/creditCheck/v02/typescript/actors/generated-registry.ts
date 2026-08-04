import { fetchInterestRateOptions } from "./fetchInterestRateOptions/fetchInterestRateOptions.ts";
import { verifyCredentials } from "./verifyCredentials/verifyCredentials.ts";
import { CheckingCreditScores3parallel } from "./CheckingCreditScores3parallel/CheckingCreditScores3parallel.ts";
import { checkReportsTable } from "./checkReportsTable/checkReportsTable.ts";
import { checkBureau } from "./checkBureau/checkBureau.ts";
import { determineMiddleScore } from "./determineMiddleScore/determineMiddleScore.ts";
import { generateInterestRates } from "./generateInterestRates/generateInterestRates.ts";

export type ActorRegistration = {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: string;
  fsmName: string;
  fsmVersion: string;
  fsmLanguage: string;
  handler: (input: unknown) => unknown;
};

export const ACTOR_REGISTRATIONS: ActorRegistration[] = [
  {
    parentFsmName: "creditCheck",
    parentFsmVersion: "v02",
    fsmType: "promise",
    fsmName: "fetchInterestRateOptions",
    fsmVersion: "v02",
    fsmLanguage: "typescript",
    handler: fetchInterestRateOptions,
  },
  {
    parentFsmName: "creditCheck",
    parentFsmVersion: "v02",
    fsmType: "promise",
    fsmName: "verifyCredentials",
    fsmVersion: "v02",
    fsmLanguage: "typescript",
    handler: verifyCredentials,
  },
  {
    parentFsmName: "creditCheck",
    parentFsmVersion: "v02",
    fsmType: "promise",
    fsmName: "CheckingCreditScores3parallel",
    fsmVersion: "v02",
    fsmLanguage: "typescript",
    handler: CheckingCreditScores3parallel,
  },
  {
    parentFsmName: "creditCheck",
    parentFsmVersion: "v02",
    fsmType: "promise",
    fsmName: "checkReportsTable",
    fsmVersion: "v02",
    fsmLanguage: "typescript",
    handler: checkReportsTable,
  },
  {
    parentFsmName: "creditCheck",
    parentFsmVersion: "v02",
    fsmType: "promise",
    fsmName: "checkBureau",
    fsmVersion: "v02",
    fsmLanguage: "typescript",
    handler: checkBureau,
  },
  {
    parentFsmName: "creditCheck",
    parentFsmVersion: "v02",
    fsmType: "promise",
    fsmName: "determineMiddleScore",
    fsmVersion: "v02",
    fsmLanguage: "typescript",
    handler: determineMiddleScore,
  },
  {
    parentFsmName: "creditCheck",
    parentFsmVersion: "v02",
    fsmType: "promise",
    fsmName: "generateInterestRates",
    fsmVersion: "v02",
    fsmLanguage: "typescript",
    handler: generateInterestRates,
  },
];
