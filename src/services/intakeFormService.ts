import { Pool } from 'pg';
import pool from '../db';

export interface IntakeFormData {
  clerk_organization_id: string;  // Input: Clerk org ID (preferred)
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
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class IntakeFormService {
  private pool: Pool;

  constructor(dbPool: Pool) {
    this.pool = dbPool;
  }

  /**
   * Get internal organization_id from clerk_organization_id
   */
  private async getOrganizationIdFromClerkId(clerkOrgId: string): Promise<string> {
    const query = `
      SELECT id FROM organizations
      WHERE clerk_organization_id = $1;
    `;
    const result = await this.pool.query<{ id: string }>(query, [clerkOrgId]);
    
    if (result.rows.length === 0) {
      throw new Error(`Organization not found for clerk_organization_id: ${clerkOrgId}`);
    }
    
    return result.rows[0].id;
  }

  /**
   * @deprecated Use getOrganizationIdFromClerkId instead.
   * Get internal organization_id from external_organization_id
   * @private
   */
  private async getOrganizationId(externalOrgId: string): Promise<string> {
    const query = `
      SELECT id FROM organizations
      WHERE external_organization_id = $1;
    `;
    const result = await this.pool.query<{ id: string }>(query, [externalOrgId]);
    
    if (result.rows.length === 0) {
      throw new Error(`Organization not found for external_organization_id: ${externalOrgId}`);
    }
    
    return result.rows[0].id;
  }

  /**
   * Upsert intake form data for an organization using Clerk organization ID
   */
  async upsertIntakeFormByClerkId(data: IntakeFormData): Promise<IntakeForm> {
    // First, get the internal organization_id from clerk_organization_id
    const organization_id = await this.getOrganizationIdFromClerkId(data.clerk_organization_id);
    
    return this.upsertIntakeFormInternal(organization_id, data);
  }

  /**
   * Internal upsert that takes an internal organization_id
   */
  private async upsertIntakeFormInternal(organization_id: string, data: IntakeFormData): Promise<IntakeForm> {
    const {
      liveblocks_room_id,
      name_and_title,
      phone_and_email,
      website_and_socials,
      images_link,
      start_date,
      bio,
      elevator_pitch,
      guest_pieces,
      interview_questions,
      quotes,
      talking_points,
      collateral,
      how_started,
      why_started,
      mission,
      story,
      previous_jobs,
      offerings,
      current_promotion,
      problem_solution,
      future_offerings,
      location,
      goals,
      help_people,
      categories,
      press_targeting,
      press_type,
      specific_outlets,
      status,
    } = data;

    const query = `
      INSERT INTO intake_forms (
        organization_id,
        liveblocks_room_id,
        name_and_title,
        phone_and_email,
        website_and_socials,
        images_link,
        start_date,
        bio,
        elevator_pitch,
        guest_pieces,
        interview_questions,
        quotes,
        talking_points,
        collateral,
        how_started,
        why_started,
        mission,
        story,
        previous_jobs,
        offerings,
        current_promotion,
        problem_solution,
        future_offerings,
        location,
        goals,
        help_people,
        categories,
        press_targeting,
        press_type,
        specific_outlets,
        status,
        last_synced_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, NOW()
      )
      ON CONFLICT (organization_id) 
      DO UPDATE SET
        liveblocks_room_id = COALESCE(EXCLUDED.liveblocks_room_id, intake_forms.liveblocks_room_id),
        name_and_title = COALESCE(EXCLUDED.name_and_title, intake_forms.name_and_title),
        phone_and_email = COALESCE(EXCLUDED.phone_and_email, intake_forms.phone_and_email),
        website_and_socials = COALESCE(EXCLUDED.website_and_socials, intake_forms.website_and_socials),
        images_link = COALESCE(EXCLUDED.images_link, intake_forms.images_link),
        start_date = COALESCE(EXCLUDED.start_date, intake_forms.start_date),
        bio = COALESCE(EXCLUDED.bio, intake_forms.bio),
        elevator_pitch = COALESCE(EXCLUDED.elevator_pitch, intake_forms.elevator_pitch),
        guest_pieces = COALESCE(EXCLUDED.guest_pieces, intake_forms.guest_pieces),
        interview_questions = COALESCE(EXCLUDED.interview_questions, intake_forms.interview_questions),
        quotes = COALESCE(EXCLUDED.quotes, intake_forms.quotes),
        talking_points = COALESCE(EXCLUDED.talking_points, intake_forms.talking_points),
        collateral = COALESCE(EXCLUDED.collateral, intake_forms.collateral),
        how_started = COALESCE(EXCLUDED.how_started, intake_forms.how_started),
        why_started = COALESCE(EXCLUDED.why_started, intake_forms.why_started),
        mission = COALESCE(EXCLUDED.mission, intake_forms.mission),
        story = COALESCE(EXCLUDED.story, intake_forms.story),
        previous_jobs = COALESCE(EXCLUDED.previous_jobs, intake_forms.previous_jobs),
        offerings = COALESCE(EXCLUDED.offerings, intake_forms.offerings),
        current_promotion = COALESCE(EXCLUDED.current_promotion, intake_forms.current_promotion),
        problem_solution = COALESCE(EXCLUDED.problem_solution, intake_forms.problem_solution),
        future_offerings = COALESCE(EXCLUDED.future_offerings, intake_forms.future_offerings),
        location = COALESCE(EXCLUDED.location, intake_forms.location),
        goals = COALESCE(EXCLUDED.goals, intake_forms.goals),
        help_people = COALESCE(EXCLUDED.help_people, intake_forms.help_people),
        categories = COALESCE(EXCLUDED.categories, intake_forms.categories),
        press_targeting = COALESCE(EXCLUDED.press_targeting, intake_forms.press_targeting),
        press_type = COALESCE(EXCLUDED.press_type, intake_forms.press_type),
        specific_outlets = COALESCE(EXCLUDED.specific_outlets, intake_forms.specific_outlets),
        status = COALESCE(EXCLUDED.status, intake_forms.status),
        last_synced_at = NOW()
      RETURNING *;
    `;

    const values = [
      organization_id,
      liveblocks_room_id,
      name_and_title,
      phone_and_email,
      website_and_socials,
      images_link,
      start_date,
      bio,
      elevator_pitch,
      guest_pieces,
      interview_questions,
      quotes,
      talking_points,
      collateral,
      how_started,
      why_started,
      mission,
      story,
      previous_jobs,
      offerings,
      current_promotion,
      problem_solution,
      future_offerings,
      location,
      goals,
      help_people,
      categories,
      press_targeting,
      press_type,
      specific_outlets,
      status,
    ];

    const result = await this.pool.query<IntakeForm>(query, values);
    return result.rows[0];
  }

  /**
   * Get intake form by Clerk organization ID
   */
  async getByClerkOrganizationId(clerkOrgId: string): Promise<IntakeForm | null> {
    // First, get the internal organization_id
    const organization_id = await this.getOrganizationIdFromClerkId(clerkOrgId);
    
    const query = `
      SELECT * FROM intake_forms
      WHERE organization_id = $1;
    `;
    const result = await this.pool.query<IntakeForm>(query, [organization_id]);
    return result.rows[0] || null;
  }

  /**
   * @deprecated Use getByClerkOrganizationId instead.
   * Get intake form by external organization ID
   */
  async getByExternalOrganizationId(externalOrgId: string): Promise<IntakeForm | null> {
    // First, get the internal organization_id
    const organization_id = await this.getOrganizationId(externalOrgId);
    
    const query = `
      SELECT * FROM intake_forms
      WHERE organization_id = $1;
    `;
    const result = await this.pool.query<IntakeForm>(query, [organization_id]);
    return result.rows[0] || null;
  }

  /**
   * Get intake form by internal organization ID (for internal use)
   * @private
   */
  private async getByOrganizationId(organizationId: string): Promise<IntakeForm | null> {
    const query = `
      SELECT * FROM intake_forms
      WHERE organization_id = $1;
    `;
    const result = await this.pool.query<IntakeForm>(query, [organizationId]);
    return result.rows[0] || null;
  }

  /**
   * Get intake form by Liveblocks room ID
   */
  async getByLiveblocksRoomId(roomId: string): Promise<IntakeForm | null> {
    const query = `
      SELECT * FROM intake_forms
      WHERE liveblocks_room_id = $1;
    `;
    const result = await this.pool.query<IntakeForm>(query, [roomId]);
    return result.rows[0] || null;
  }

  /**
   * Delete intake form by Clerk organization ID
   */
  async deleteByClerkOrganizationId(clerkOrgId: string): Promise<boolean> {
    // First, get the internal organization_id
    const organization_id = await this.getOrganizationIdFromClerkId(clerkOrgId);
    
    const query = `
      DELETE FROM intake_forms
      WHERE organization_id = $1
      RETURNING id;
    `;
    const result = await this.pool.query(query, [organization_id]);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  /**
   * @deprecated Use deleteByClerkOrganizationId instead.
   * Delete intake form by external organization ID
   */
  async deleteByExternalOrganizationId(externalOrgId: string): Promise<boolean> {
    // First, get the internal organization_id
    const organization_id = await this.getOrganizationId(externalOrgId);
    
    const query = `
      DELETE FROM intake_forms
      WHERE organization_id = $1
      RETURNING id;
    `;
    const result = await this.pool.query(query, [organization_id]);
    return result.rowCount ? result.rowCount > 0 : false;
  }
}

// Export singleton instance
export const intakeFormService = new IntakeFormService(pool);
