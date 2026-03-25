import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { wallet } from "./wallet.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import { getWalletPositions } from "./dlmm.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function zapOut({ position_address, output_mint = SOL_MINT }) {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const user = Keypair.fromSecretKey(new Uint8Array(wallet));

    log("zapout", `Zapping out position ${position_address} to ${output_mint}`);

    try {
        const positions = await getWalletPositions({});
        const position = positions.find(p => p.position_address === position_address);
        
        if (!position) {
            throw new Error(`Position ${position_address} not found`);
        }

        const inputMint = position.token_x === SOL_MINT ? position.token_y : position.token_x;
        const lbPairAddress = new PublicKey(position.pool_address);

        log("zapout", `Input mint: ${inputMint}, Output mint: ${output_mint}`);

        const { Zap } = await import("@meteora-ag/zap-sdk");
        const BN = (await import("bn.js")).default;
        const zap = new Zap(connection);

        const zapOutTx = await zap.zapOutThroughDlmm({
            user: user.publicKey,
            lbPairAddress: lbPairAddress,
            inputMint: new PublicKey(inputMint),
            outputMint: new PublicKey(output_mint),
            inputTokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            outputTokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            amountIn: new BN(position.liquidity),
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
            pool: position.pool_address,
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
