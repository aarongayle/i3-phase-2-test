// Express Route: GET /api/schedules/:clientId/:date
// Returns optimal schedules for a specific date

import { Router } from "express";
import { ensureShortSchedulesForDate } from "../../lib/schedule-store.js";

const router = Router();

router.get("/:clientId/:date", async (req, res) => {
  try {
    const { clientId, date } = req.params;

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }

    if (!date) {
      return res.status(400).json({ error: "date is required" });
    }

    console.log(
      `[Schedules API] Fetching schedules for clientId: ${clientId}, date: ${date}`
    );

    const schedules = await ensureShortSchedulesForDate(clientId, date);
    console.log(
      `[Schedules API] ✓ ${schedules.length} schedules for ${clientId}/${date}`
    );

    return res.status(200).json({ schedules });
  } catch (error) {
    console.error("[Schedules API] Error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error",
    });
  }
});

export default router;
