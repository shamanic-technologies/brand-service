import { relations } from "drizzle-orm/relations";
import { orgs, brands, individuals, individualsPdlEnrichment, supabaseStorage, mediaAssets, brandLinkedinPosts, brandSalesProfiles, individualsLinkedinPosts, intakeForms, brandThesis, users, brandRelations, brandIndividuals } from "./schema";

export const brandsRelations = relations(brands, ({one, many}) => ({
	org: one(orgs, {
		fields: [brands.orgId],
		references: [orgs.id]
	}),
	mediaAssets: many(mediaAssets),
	brandLinkedinPosts: many(brandLinkedinPosts),
	brandSalesProfiles: many(brandSalesProfiles),
	intakeForms: many(intakeForms),
	brandTheses_brandId: many(brandThesis, {
		relationName: "brandThesis_brandId_brands_id"
	}),
	brandTheses_brandId: many(brandThesis, {
		relationName: "brandThesis_brandId_brands_id"
	}),
	brandRelations_sourceBrandId: many(brandRelations, {
		relationName: "brandRelations_sourceBrandId_brands_id"
	}),
	brandRelations_targetBrandId: many(brandRelations, {
		relationName: "brandRelations_targetBrandId_brands_id"
	}),
	brandIndividuals: many(brandIndividuals),
}));

export const orgsRelations = relations(orgs, ({many}) => ({
	brands: many(brands),
}));

export const individualsPdlEnrichmentRelations = relations(individualsPdlEnrichment, ({one}) => ({
	individual: one(individuals, {
		fields: [individualsPdlEnrichment.individualId],
		references: [individuals.id]
	}),
}));

export const individualsRelations = relations(individuals, ({many}) => ({
	individualsPdlEnrichments: many(individualsPdlEnrichment),
	individualsLinkedinPosts: many(individualsLinkedinPosts),
	brandIndividuals: many(brandIndividuals),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({one}) => ({
	supabaseStorage: one(supabaseStorage, {
		fields: [mediaAssets.supabaseStorageId],
		references: [supabaseStorage.id]
	}),
	brand: one(brands, {
		fields: [mediaAssets.brandId],
		references: [brands.id]
	}),
}));

export const supabaseStorageRelations = relations(supabaseStorage, ({many}) => ({
	mediaAssets: many(mediaAssets),
}));

export const brandLinkedinPostsRelations = relations(brandLinkedinPosts, ({one}) => ({
	brand: one(brands, {
		fields: [brandLinkedinPosts.brandId],
		references: [brands.id]
	}),
}));

export const brandSalesProfilesRelations = relations(brandSalesProfiles, ({one}) => ({
	brand: one(brands, {
		fields: [brandSalesProfiles.brandId],
		references: [brands.id]
	}),
}));

export const individualsLinkedinPostsRelations = relations(individualsLinkedinPosts, ({one}) => ({
	individual: one(individuals, {
		fields: [individualsLinkedinPosts.individualId],
		references: [individuals.id]
	}),
}));

export const intakeFormsRelations = relations(intakeForms, ({one}) => ({
	brand: one(brands, {
		fields: [intakeForms.brandId],
		references: [brands.id]
	}),
}));

export const brandThesisRelations = relations(brandThesis, ({one}) => ({
	brand_brandId: one(brands, {
		fields: [brandThesis.brandId],
		references: [brands.id],
		relationName: "brandThesis_brandId_brands_id"
	}),
	user: one(users, {
		fields: [brandThesis.statusChangedByUserId],
		references: [users.id]
	}),
	brand_brandId: one(brands, {
		fields: [brandThesis.brandId],
		references: [brands.id],
		relationName: "brandThesis_brandId_brands_id"
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	brandTheses: many(brandThesis),
}));

export const brandRelationsRelations = relations(brandRelations, ({one}) => ({
	brand_sourceBrandId: one(brands, {
		fields: [brandRelations.sourceBrandId],
		references: [brands.id],
		relationName: "brandRelations_sourceBrandId_brands_id"
	}),
	brand_targetBrandId: one(brands, {
		fields: [brandRelations.targetBrandId],
		references: [brands.id],
		relationName: "brandRelations_targetBrandId_brands_id"
	}),
}));

export const brandIndividualsRelations = relations(brandIndividuals, ({one}) => ({
	individual: one(individuals, {
		fields: [brandIndividuals.individualId],
		references: [individuals.id]
	}),
	brand: one(brands, {
		fields: [brandIndividuals.brandId],
		references: [brands.id]
	}),
}));