import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { Feature, featuresTableName } from "../tables/features.table";

/** Data access for SaaS feature definitions. */
export class FeatureModel extends BasicDataModel(Feature, featuresTableName) {}
