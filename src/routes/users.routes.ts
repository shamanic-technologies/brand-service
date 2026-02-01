import { Router, Request, Response } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import { db, users } from '../db';

const router = Router();

/**
 * GET /users/list
 * Returns all users from brand-service users table.
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const result = await db
      .select({
        id: users.id,
        clerk_user_id: users.clerkUserId,
        created_at: users.createdAt,
        updated_at: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return res.status(200).json({
      users: result,
      stats: {
        total: result.length,
      },
    });
  } catch (error) {
    console.error('[users/list] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch users list' });
  }
});

/**
 * DELETE /users/:clerkUserId
 * Deletes a user from brand-service database.
 */
router.delete('/:clerkUserId', async (req: Request, res: Response) => {
  const { clerkUserId } = req.params;

  if (!clerkUserId) {
    return res.status(400).json({ error: 'Clerk User ID is required' });
  }

  try {
    // Find the user
    const userResult = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (userResult.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: `No user found with clerk_user_id: ${clerkUserId}`,
      });
    }

    const userId = userResult[0].id;

    // Delete the user (cascades will handle related data)
    await db.delete(users).where(eq(users.id, userId));

    console.log(`[users/delete] Successfully deleted user ${clerkUserId}`);

    return res.status(200).json({
      success: true,
      message: `User ${clerkUserId} deleted successfully`,
    });
  } catch (error) {
    console.error('[users/delete] Error:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
