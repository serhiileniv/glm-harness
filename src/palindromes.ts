/**
 * Palindrome utility for validating and generating palindromes
 */

export interface PalindromeOptions {
  /** Minimum length of palindrome to generate */
  minLength?: number;
  /** Maximum length of palindrome to generate */
  maxLength?: number;
  /** Include only alphanumeric characters */
  alphanumericOnly?: boolean;
  /** Include only lowercase letters */
  lowercaseOnly?: boolean;
  /** Include only uppercase letters */
  uppercaseOnly?: boolean;
}

/**
 * Check if a string is a palindrome
 * @param str - The string to check
 * @param options - Options for palindrome checking
 * @returns True if the string is a palindrome
 */
export function isPalindrome(str: string, options: PalindromeOptions = {}): boolean {
  const { alphanumericOnly = true, lowercaseOnly = true } = options;

  // Filter and normalize the string
  let cleaned = str;
  if (alphanumericOnly) {
    cleaned = cleaned.replace(/[^a-zA-Z0-9]/g, '');
  }
  if (lowercaseOnly) {
    cleaned = cleaned.toLowerCase();
  }

  // Check if the cleaned string equals its reverse
  return cleaned === cleaned.split('').reverse().join('');
}

/**
 * Generate a random palindrome
 * @param options - Options for palindrome generation
 * @returns A random palindrome string
 */
export function generatePalindrome(options: PalindromeOptions = {}): string {
  const {
    minLength = 5,
    maxLength = 15,
    alphanumericOnly = true,
    lowercaseOnly = true,
    uppercaseOnly = false,
  } = options;

  // Validate length constraints
  const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
  const halfLength = Math.ceil(length / 2);

  // Generate the first half
  let half = '';
  for (let i = 0; i < halfLength; i++) {
    if (alphanumericOnly) {
      const char = Math.random() > 0.5 ? String.fromCharCode(65 + Math.floor(Math.random() * 26)) : String.fromCharCode(48 + Math.floor(Math.random() * 10));
      half += char;
    } else {
      half += String.fromCharCode(97 + Math.floor(Math.random() * 26));
    }
  }

  // Mirror the first half to create the palindrome
  let palindrome = half;
  if (length % 2 === 0) {
    palindrome += half.split('').reverse().join('');
  } else {
    palindrome += half.slice(0, -1).split('').reverse().join('');
  }

  // Apply case constraints
  if (uppercaseOnly) {
    palindrome = palindrome.toUpperCase();
  } else if (lowercaseOnly) {
    palindrome = palindrome.toLowerCase();
  }

  return palindrome;
}

/**
 * Get a list of common palindromes
 * @returns Array of common palindrome strings
 */
export const COMMON_PALINDROMES = [
  'racecar',
  'level',
  'kayak',
  'madam',
  'radar',
  'rotor',
  'civic',
  'refer',
  'tenet',
  'noon',
  'deified',
  'repaper',
  'reviver',
  'redder',
  'rotator',
  'sagas',
  'solos',
  'stats',
  'sexes',
  'shahs',
  'minim',
  'dewed',
  'peep',
  'poop',
  'toot',
  'deed',
  'peep',
  'noon',
  'pullup',
  'sexes',
  'shahs',
  'stats',
  'sagas',
  'solos',
];

/**
 * Create a palindrome from a given string
 * @param str - The base string to create a palindrome from
 * @returns A palindrome that starts with the given string
 */
export function createPalindrome(str: string): string {
  const cleaned = str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return cleaned + cleaned.split('').reverse().join('');
}

/**
 * Get all palindromes of a certain length
 * @param length - The length of palindromes to find
 * @param alphanumericOnly - Whether to include only alphanumeric characters
 * @returns Array of palindromes of the specified length
 */
export function getPalindromesOfLength(
  length: number,
  alphanumericOnly: boolean = true
): string[] {
  const palindromes: string[] = [];
  
  // Calculate half length
  const halfLength = Math.ceil(length / 2);
  const chars = alphanumericOnly ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' : 'abcdefghijklmnopqrstuvwxyz';
  
  // Generate all possible palindromes of this length
  for (let i = 0; i < Math.pow(chars.length, halfLength); i++) {
    let half = '';
    let temp = i;
    
    for (let j = 0; j < halfLength; j++) {
      half = chars[temp % chars.length] + half;
      temp = Math.floor(temp / chars.length);
    }
    
    // Mirror the first half
    let palindrome = half;
    if (length % 2 === 0) {
      palindrome += half.split('').reverse().join('');
    } else {
      palindrome += half.slice(0, -1).split('').reverse().join('');
    }
    
    palindromes.push(palindrome);
  }
  
  return palindromes;
}
