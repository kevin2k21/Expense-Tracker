package com.spendlocal.sms

internal object SmsFilter {
  private val transactionWords = listOf(
    "debited", "credited", "spent", "purchase", "withdrawn", "withdrawal",
    "paid", "sent", "received", "deposited", "deducted", "used", "charged",
    "upi", "imps", "neft", "rtgs", "nach", "pos", "atm", "avl bal",
    "available balance", "txn", "transaction", "refund", "reversed", "a/c",
    "acct", "account", "card ending", "ending with",
  )

  fun looksFinancial(sender: String, body: String): Boolean {
    val normalized = body.lowercase()
    val hasAmount = Regex("(?:rs\\.?|inr|₹)\\s*[\\d,]+(?:\\.\\d{1,2})?", RegexOption.IGNORE_CASE)
      .containsMatchIn(body)
    val hasSignal = transactionWords.any(normalized::contains)
    val bankLikeSender = sender.any(Char::isLetter) && sender.length <= 15
    return hasAmount && (hasSignal || bankLikeSender)
  }
}
