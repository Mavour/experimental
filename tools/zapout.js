import DLMM from "@meteora-ag/dlmm";
import { Zap } from "@meteora-ag/zap-sdk";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { wallet } from "./wallet.js";
import { config } from "../config.js";
import { getTrackedPosition } from "../state.js";
import { log } from "../logger.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function zapOut({ position_address, output_mint = SOL_MINT }) {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const user = Keypair.fromSecretKey(new Uint8Array(wallet));

    log("zapout", `Zapping out position ${position_address} to ${output_mint}`);

    try {
        const position = await DLMM.getPositionByAddress(connection, new PublicKey(position_address));
        if (!position) {
            throw new Error(`Position ${position_address} not found`);
        }

        const poolAddress = position.lbPair;
        const dlmmPool = await DLMM.create(connection, poolAddress);

        const zap = new Zap(connection);

        const inputMint = position.tokenX.publicKey.toString() === SOL_MINT 
            ? position.tokenY.publicKey.toString() 
            : position.tokenX.publicKey.toString();

        log("zapout", `Input mint: ${inputMint}, Output mint: ${output_mint}`);

        const zapOutTx = await zap.zapOutThroughDlmm({
            user: user.publicKey,
            lbPairAddress: poolAddress,
            inputMint: new PublicKey(inputMint),
            outputMint: new PublicKey(output_mint),
            inputTokenProgram: new PublicKey(inputMint === SOL_MINT ? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" : "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            outputTokenProgram: new PublicKey(SOL_MINT === output_mint ? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" : "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            amountIn: position.liquidityAmount,
            minimumSwapAmountOut: new (require("bn.js"))(0),
            maxSwapAmount: new (require("bn.js"))(0),
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
            pool: poolAddress.toString(),
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
