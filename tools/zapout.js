import { PublicKey } from "@solana/web3.js";
import { log } from "../logger.js";
import { getMyPositions, getWallet, getConnection } from "./dlmm.js";
import { getPoolDetail } from "./screening.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function zapOut({ position_address, output_mint = SOL_MINT }) {
    const connection = getConnection();
    const user = getWallet();

    log("zapout", `Zapping out position ${position_address} to ${output_mint}`);

    try {
        const result = await getMyPositions({ force: true });
        const positions = result.positions;
        const position = positions.find(p => p.position === position_address);
        
        if (!position) {
            throw new Error(`Position ${position_address} not found`);
        }

        const poolAddress = position.pool;
        const poolDetail = await getPoolDetail({ pool_address: poolAddress });
        
        const tokenX = poolDetail.token_x?.address;
        const tokenY = poolDetail.token_y?.address;
        const inputMint = tokenX === SOL_MINT ? tokenY : tokenX;
        const lbPairAddress = new PublicKey(poolAddress);

        log("zapout", `Input mint: ${inputMint}, Output mint: ${output_mint}`);

        const { Zap } = await import("@meteora-ag/zap-sdk");
        const BN = (await import("bn.js")).default;
        const zap = new Zap(connection);

        const totalValue = position.total_value_usd || 1;
        const amountIn = new BN(Math.floor(totalValue * 1e9));

        const zapOutTx = await zap.zapOutThroughDlmm({
            user: user.publicKey,
            lbPairAddress: lbPairAddress,
            inputMint: new PublicKey(inputMint),
            outputMint: new PublicKey(output_mint),
            inputTokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            outputTokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            amountIn: amountIn,
            minimumSwapAmountOut: new BN(0),
            maxSwapAmount: new BN(0),
            percentageToZapOut: 100,
        });

        const { blockhash } = await connection.getLatestBlockhash();
        zapOutTx.recentBlockhash = blockhash;
        zapOutTx.feePayer = user.publicKey;

        const signedTx = await user.signTransaction(zapOutTx);
        const txHash = await connection.sendRawTransaction(signedTx.serialize());

        log("zapout", `Zap out successful: ${txHash}`);

        return {
            success: true,
            tx: txHash,
            position: position_address,
            pool: poolAddress,
            input_mint: inputMint,
            output_mint: output_mint,
        };
    } catch (error) {
        log("zapout_error", error.message);
        return {
            success: false,
            error: error.message,
            position: position_address,
        };
    }
}
