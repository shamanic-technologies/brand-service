import { eq, sql } from 'drizzle-orm';
import { db, brands, intakeForms, orgs } from '../db';

export interface IntakeFormData {
  clerk_organization_id: string;
  liveblocks_room_id?: string | null;
  name_and_title?: string | null;
  phone_and_email?: string | null;
  website_and_socials?: string | null;
  images_link?: string | null;
  start_date?: string | null;
  bio?: string | null;
  elevator_pitch?: string | null;
  guest_pieces?: string | null;
  interview_questions?: string | null;
  quotes?: string | null;
  talking_points?: string | null;
  collateral?: string | null;
  how_started?: string | null;
  why_started?: string | null;
  mission?: string | null;
  story?: string | null;
  previous_jobs?: string | null;
  offerings?: string | null;
  current_promotion?: string | null;
  problem_solution?: string | null;
  future_offerings?: string | null;
  location?: string | null;
  goals?: string | null;
  help_people?: string | null;
  categories?: string | null;
  press_targeting?: string | null;
  press_type?: string | null;
  specific_outlets?: string | null;
  status?: 'generating' | null;
}

export interface IntakeForm extends IntakeFormData {
  id: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

async function getBrandIdFromClerkId(clerkOrgId: string): Promise<string> {
  const result = await db
    .select({ id: brands.id })
    .from(brands)
    .innerJoin(orgs, eq(brands.orgId, orgs.id))
    .where(eq(orgs.clerkOrgId, clerkOrgId))
    .limit(1);

  if (result.length === 0) {
    throw new Error(`Brand not found for clerk_organization_id: ${clerkOrgId}`);
  }

  return result[0].id;
}

function formatIntakeForm(row: typeof intakeForms.$inferSelect): IntakeForm {
  return {
    id: row.id,
    clerk_organization_id: '', // Not stored in intake_forms, caller should know it
    liveblocks_room_id: row.liveblocksRoomId,
    name_and_title: row.nameAndTitle,
    phone_and_email: row.phoneAndEmail,
    website_and_socials: row.websiteAndSocials,
    images_link: row.imagesLink,
    start_date: row.startDate,
    bio: row.bio,
    elevator_pitch: row.elevatorPitch,
    guest_pieces: row.guestPieces,
    interview_questions: row.interviewQuestions,
    quotes: row.quotes,
    talking_points: row.talkingPoints,
    collateral: row.collateral,
    how_started: row.howStarted,
    why_started: row.whyStarted,
    mission: row.mission,
    story: row.story,
    previous_jobs: row.previousJobs,
    offerings: row.offerings,
    current_promotion: row.currentPromotion,
    problem_solution: row.problemSolution,
    future_offerings: row.futureOfferings,
    location: row.location,
    goals: row.goals,
    help_people: row.helpPeople,
    categories: row.categories,
    press_targeting: row.pressTargeting,
    press_type: row.pressType,
    specific_outlets: row.specificOutlets,
    status: row.status as 'generating' | null,
    last_synced_at: row.lastSyncedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export class IntakeFormService {
  async upsertIntakeFormByClerkId(data: IntakeFormData): Promise<IntakeForm> {
    const brandId = await getBrandIdFromClerkId(data.clerk_organization_id);

    const result = await db
      .insert(intakeForms)
      .values({
        brandId,
        liveblocksRoomId: data.liveblocks_room_id,
        nameAndTitle: data.name_and_title,
        phoneAndEmail: data.phone_and_email,
        websiteAndSocials: data.website_and_socials,
        imagesLink: data.images_link,
        startDate: data.start_date,
        bio: data.bio,
        elevatorPitch: data.elevator_pitch,
        guestPieces: data.guest_pieces,
        interviewQuestions: data.interview_questions,
        quotes: data.quotes,
        talkingPoints: data.talking_points,
        collateral: data.collateral,
        howStarted: data.how_started,
        whyStarted: data.why_started,
        mission: data.mission,
        story: data.story,
        previousJobs: data.previous_jobs,
        offerings: data.offerings,
        currentPromotion: data.current_promotion,
        problemSolution: data.problem_solution,
        futureOfferings: data.future_offerings,
        location: data.location,
        goals: data.goals,
        helpPeople: data.help_people,
        categories: data.categories,
        pressTargeting: data.press_targeting,
        pressType: data.press_type,
        specificOutlets: data.specific_outlets,
        status: data.status,
        lastSyncedAt: sql`NOW()`,
      })
      .onConflictDoUpdate({
        target: intakeForms.brandId,
        set: {
          liveblocksRoomId: sql`COALESCE(EXCLUDED.liveblocks_room_id, ${intakeForms.liveblocksRoomId})`,
          nameAndTitle: sql`COALESCE(EXCLUDED.name_and_title, ${intakeForms.nameAndTitle})`,
          phoneAndEmail: sql`COALESCE(EXCLUDED.phone_and_email, ${intakeForms.phoneAndEmail})`,
          websiteAndSocials: sql`COALESCE(EXCLUDED.website_and_socials, ${intakeForms.websiteAndSocials})`,
          imagesLink: sql`COALESCE(EXCLUDED.images_link, ${intakeForms.imagesLink})`,
          startDate: sql`COALESCE(EXCLUDED.start_date, ${intakeForms.startDate})`,
          bio: sql`COALESCE(EXCLUDED.bio, ${intakeForms.bio})`,
          elevatorPitch: sql`COALESCE(EXCLUDED.elevator_pitch, ${intakeForms.elevatorPitch})`,
          guestPieces: sql`COALESCE(EXCLUDED.guest_pieces, ${intakeForms.guestPieces})`,
          interviewQuestions: sql`COALESCE(EXCLUDED.interview_questions, ${intakeForms.interviewQuestions})`,
          quotes: sql`COALESCE(EXCLUDED.quotes, ${intakeForms.quotes})`,
          talkingPoints: sql`COALESCE(EXCLUDED.talking_points, ${intakeForms.talkingPoints})`,
          collateral: sql`COALESCE(EXCLUDED.collateral, ${intakeForms.collateral})`,
          howStarted: sql`COALESCE(EXCLUDED.how_started, ${intakeForms.howStarted})`,
          whyStarted: sql`COALESCE(EXCLUDED.why_started, ${intakeForms.whyStarted})`,
          mission: sql`COALESCE(EXCLUDED.mission, ${intakeForms.mission})`,
          story: sql`COALESCE(EXCLUDED.story, ${intakeForms.story})`,
          previousJobs: sql`COALESCE(EXCLUDED.previous_jobs, ${intakeForms.previousJobs})`,
          offerings: sql`COALESCE(EXCLUDED.offerings, ${intakeForms.offerings})`,
          currentPromotion: sql`COALESCE(EXCLUDED.current_promotion, ${intakeForms.currentPromotion})`,
          problemSolution: sql`COALESCE(EXCLUDED.problem_solution, ${intakeForms.problemSolution})`,
          futureOfferings: sql`COALESCE(EXCLUDED.future_offerings, ${intakeForms.futureOfferings})`,
          location: sql`COALESCE(EXCLUDED.location, ${intakeForms.location})`,
          goals: sql`COALESCE(EXCLUDED.goals, ${intakeForms.goals})`,
          helpPeople: sql`COALESCE(EXCLUDED.help_people, ${intakeForms.helpPeople})`,
          categories: sql`COALESCE(EXCLUDED.categories, ${intakeForms.categories})`,
          pressTargeting: sql`COALESCE(EXCLUDED.press_targeting, ${intakeForms.pressTargeting})`,
          pressType: sql`COALESCE(EXCLUDED.press_type, ${intakeForms.pressType})`,
          specificOutlets: sql`COALESCE(EXCLUDED.specific_outlets, ${intakeForms.specificOutlets})`,
          status: sql`COALESCE(EXCLUDED.status, ${intakeForms.status})`,
          lastSyncedAt: sql`NOW()`,
        },
      })
      .returning();

    const form = formatIntakeForm(result[0]);
    form.clerk_organization_id = data.clerk_organization_id;
    return form;
  }

  async getByClerkOrganizationId(clerkOrgId: string): Promise<IntakeForm | null> {
    const brandId = await getBrandIdFromClerkId(clerkOrgId);

    const result = await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.brandId, brandId))
      .limit(1);

    if (result.length === 0) return null;

    const form = formatIntakeForm(result[0]);
    form.clerk_organization_id = clerkOrgId;
    return form;
  }

  async getByLiveblocksRoomId(roomId: string): Promise<IntakeForm | null> {
    const result = await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.liveblocksRoomId, roomId))
      .limit(1);

    return result.length > 0 ? formatIntakeForm(result[0]) : null;
  }

  async deleteByClerkOrganizationId(clerkOrgId: string): Promise<boolean> {
    const brandId = await getBrandIdFromClerkId(clerkOrgId);

    const result = await db
      .delete(intakeForms)
      .where(eq(intakeForms.brandId, brandId))
      .returning({ id: intakeForms.id });

    return result.length > 0;
  }
}

export const intakeFormService = new IntakeFormService();
