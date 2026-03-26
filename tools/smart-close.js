import { closePosition } from "./dlmm.js";
import { zapOut } from "./zapout.js";
import { getPositionPnl } from "./dlmm.js";
import { log } from "../logger.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function smartClose({ position_address, min_fee_for_zapout = 0.1 }) {
    log("smart_close", `Smart close for position ${position_address?.slice(0, 8)}`);

    try {
        // Get position PnL to check unclaimed fees
        const pnl = await getPositionPnl({ position_address });
        const unclaimedFees = pnl?.unclaimed_fee_usd ?? 0;

        log("smart_close", `Unclaimed fees: $${unclaimedFees.toFixed(4)}`);

        if (unclaimedFees > min_fee_for_zapout) {
            log("smart_close", `Fees > $${min_fee_for_zapout} → Using zap_out`);
            const result = await zapOut({ position_address, output_mint: SOL_MINT });
            return {
                ...result,
                method: "zap_out",
                fees_at_close: unclaimedFees,
            };
        } else {
            log("smart_close", `Fees ≤ $${min_fee_for_zapout} → Using close_position`);
            const result = await closePosition({ position_address });
            return {
                ...result,
                method: "close_position",
                fees_at_close: unclaimedFees,
            };
        }
    } catch (error) {
        log("smart_close_error", error.message);
        return {
            success: false,
            error: error.message,
            position: position_address,
        };
    }
}
